-- Stage 4: persistence and authority only. Installing this migration does not
-- activate processing. No worker, scheduling, replay, or external side effects.
create table private.automation_processing_state (
  singleton boolean primary key default true check(singleton),
  active boolean not null default false,
  activated_at timestamptz,
  activation_transaction xid8,
  generation bigint not null default 0 check(generation>=0),
  check(not active or (activated_at is not null and activation_transaction is not null))
);
insert into private.automation_processing_state(singleton) values(true);

-- Operational owner-only switch. Every activation establishes a new cutoff.
create function private.set_automation_processing(active boolean) returns void
language plpgsql set search_path='' as $$
begin
  update private.automation_processing_state s set active=$1,
    activated_at=case when $1 and not s.active then clock_timestamp() else s.activated_at end,
    activation_transaction=case when $1 and not s.active then pg_current_xact_id() else s.activation_transaction end,
    generation=s.generation+case when $1 and not s.active then 1 else 0 end;
end $$;

-- Wall-clock cutoffs alone cannot distinguish an uncommitted enable/version
-- transaction from one visible when the event was captured. These private
-- markers close that race without changing Stage 1/2 APIs or the event envelope.
alter table private.domain_events add column capture_transaction xid8 not null default pg_current_xact_id();
alter table private.domain_events add column capture_snapshot pg_snapshot not null default pg_current_snapshot();
create table private.automation_version_visibility (
  organization_id uuid not null, rule_id uuid not null, version bigint not null,
  created_transaction xid8 not null default pg_current_xact_id(),
  primary key(organization_id,rule_id,version),
  foreign key(organization_id,rule_id,version) references public.automation_rule_versions(organization_id,rule_id,version)
);
-- Pre-migration versions are marked at installation; processing is still off.
insert into private.automation_version_visibility(organization_id,rule_id,version)
select organization_id,rule_id,version from public.automation_rule_versions;
create function private.record_automation_version_visibility() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.automation_version_visibility(organization_id,rule_id,version) values(new.organization_id,new.rule_id,new.version);
  return new;
end $$;
create trigger automation_version_visibility after insert on public.automation_rule_versions for each row execute function private.record_automation_version_visibility();
create trigger automation_version_visibility_immutable before update or delete on private.automation_version_visibility for each row execute function private.protect_audit_event();

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  rule_id uuid not null, rule_version bigint not null, rule_name text not null,
  event_id uuid not null, delivery_id uuid not null,
  trigger_type text not null, entity_type text not null, entity_id uuid not null,
  correlation_id uuid not null, causation_id uuid, root_event_id uuid not null, depth integer not null check(depth between 0 and 7),
  processing_generation bigint not null,
  expected_entity_revision bigint not null check(expected_entity_revision between 1 and 9007199254740991),
  started_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  duration_ms bigint generated always as (floor(extract(epoch from (completed_at-started_at))*1000)::bigint) stored,
  status text not null check(status in ('running','succeeded','failed','partially_completed','skipped')),
  conditions jsonb not null check(jsonb_typeof(conditions)='array'),
  actions_attempted integer not null default 0 check(actions_attempted between 0 and 20),
  error_code text check(error_code in ('stale_entity','unavailable_reference','rule_unavailable','processing_inactive','unsupported_action','chain_limit','action_failed')),
  unique(organization_id,id), unique(organization_id,event_id,rule_id),
  foreign key(organization_id,rule_id,rule_version) references public.automation_rule_versions(organization_id,rule_id,version),
  foreign key(organization_id,event_id) references private.domain_events(organization_id,id),
  foreign key(organization_id,causation_id) references private.domain_events(organization_id,id),
  foreign key(organization_id,root_event_id) references private.domain_events(organization_id,id),
  check((status='running')=(completed_at is null)),
  check(completed_at is null or completed_at>=started_at)
);
alter table private.domain_event_deliveries add unique(organization_id,id);
alter table public.automation_executions add foreign key(organization_id,delivery_id) references private.domain_event_deliveries(organization_id,id);
alter table private.domain_events add foreign key(organization_id,automation_execution_id) references public.automation_executions(organization_id,id);

create table public.automation_execution_steps (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, execution_id uuid not null,
  action_id text not null, action_type text not null, position integer not null check(position between 0 and 19),
  idempotency_key uuid not null default gen_random_uuid() unique,
  attempts integer not null default 0 check(attempts between 0 and 1),
  status text not null check(status in ('pending','running','succeeded','failed','not_attempted')),
  started_at timestamptz, completed_at timestamptz,
  duration_ms bigint generated always as (floor(extract(epoch from (completed_at-started_at))*1000)::bigint) stored,
  result jsonb check(result is null or (private.automation_object(result,array['code','entityType','entityId']) and result->>'code'='completed')),
  error_code text check(error_code in ('stale_entity','unavailable_reference','rule_unavailable','processing_inactive','unsupported_action','chain_limit','action_failed')),
  unique(organization_id,id), unique(organization_id,execution_id,id),
  unique(execution_id,position), unique(execution_id,action_id),
  foreign key(organization_id,execution_id) references public.automation_executions(organization_id,id),
  check((status in ('succeeded','failed'))=(completed_at is not null)),
  check((status in ('running','succeeded','failed'))=(started_at is not null)),
  check((status='succeeded')=(result is not null)),
  check(completed_at is null or completed_at>=started_at)
);
create table private.automation_chains (
  organization_id uuid not null references public.organizations(id), correlation_id uuid not null,
  execution_count integer not null default 0 check(execution_count between 0 and 32),
  action_count integer not null default 0 check(action_count between 0 and 100),
  primary key(organization_id,correlation_id)
);
create table private.automation_chain_claims (
  organization_id uuid not null, correlation_id uuid not null, rule_id uuid not null,
  entity_type text not null, entity_id uuid not null, execution_id uuid not null,
  primary key(organization_id,correlation_id,rule_id,entity_type,entity_id),
  foreign key(organization_id,correlation_id) references private.automation_chains(organization_id,correlation_id),
  foreign key(organization_id,execution_id) references public.automation_executions(organization_id,id)
);
-- Only the command function can insert this transaction-local authority. GUCs,
-- service JWT subjects and caller JSON cannot fabricate this private record.
create table private.automation_command_contexts (
  transaction_id xid8 primary key,
  organization_id uuid not null, execution_id uuid not null, step_id uuid not null,
  foreign key(organization_id,execution_id,step_id) references public.automation_execution_steps(organization_id,execution_id,id)
);
create index automation_executions_history on public.automation_executions(organization_id,rule_id,started_at desc,id);
create index automation_executions_delivery on public.automation_executions(organization_id,delivery_id);
create index automation_executions_version on public.automation_executions(organization_id,rule_id,rule_version);
create index automation_executions_correlation on public.automation_executions(organization_id,correlation_id);
create index automation_executions_cause on public.automation_executions(organization_id,causation_id);
create index automation_executions_root on public.automation_executions(organization_id,root_event_id);
create index automation_chain_claim_execution on private.automation_chain_claims(organization_id,execution_id);
create index domain_events_execution on private.domain_events(organization_id,automation_execution_id) where automation_execution_id is not null;

alter table public.automation_executions enable row level security;
alter table public.automation_execution_steps enable row level security;
alter table private.automation_processing_state enable row level security;
alter table private.automation_chains enable row level security;
alter table private.automation_chain_claims enable row level security;
alter table private.automation_command_contexts enable row level security;
alter table private.automation_version_visibility enable row level security;
revoke all on public.automation_executions,public.automation_execution_steps,
  private.automation_processing_state,private.automation_chains,private.automation_chain_claims,private.automation_command_contexts,private.automation_version_visibility from public,anon,authenticated,service_role;
grant select on public.automation_executions,public.automation_execution_steps to authenticated;
create policy automation_execution_admin_read on public.automation_executions for select to authenticated using(private.has_organization_role(organization_id,array['administrator']::public.app_role[]));
create policy automation_step_admin_read on public.automation_execution_steps for select to authenticated using(private.has_organization_role(organization_id,array['administrator']::public.app_role[]));
create policy automation_execution_mfa on public.automation_executions as restrictive for select to authenticated using((select private.has_required_assurance()));
create policy automation_step_mfa on public.automation_execution_steps as restrictive for select to authenticated using((select private.has_required_assurance()));

-- Frozen ECMAScript default lowercase data (Unicode 17.0). PostgreSQL
-- lower() is locale-dependent and differs for dotted I and final sigma. This
-- trusted mapping is data, not executable rule configuration. Cased and
-- Case_Ignorable ranges implement Unicode's Final_Sigma context exactly.
create function private.automation_lower(value text) returns text
language plpgsql immutable strict set search_path='' as $$
declare
  cased int4multirange:='{[65,91),[97,123),[170,171),[181,182),[186,187),[192,215),[216,247),[248,443),[444,448),[452,660),[662,697),[704,706),[736,741),[837,838),[880,884),[886,888),[890,894),[895,896),[902,903),[904,907),[908,909),[910,930),[931,1014),[1015,1154),[1162,1328),[1329,1367),[1376,1417),[4256,4294),[4295,4296),[4301,4302),[4304,4347),[4348,4352),[5024,5110),[5112,5118),[7296,7307),[7312,7355),[7357,7360),[7424,7616),[7680,7958),[7960,7966),[7968,8006),[8008,8014),[8016,8024),[8025,8026),[8027,8028),[8029,8030),[8031,8062),[8064,8117),[8118,8125),[8126,8127),[8130,8133),[8134,8141),[8144,8148),[8150,8156),[8160,8173),[8178,8181),[8182,8189),[8305,8306),[8319,8320),[8336,8349),[8450,8451),[8455,8456),[8458,8468),[8469,8470),[8473,8478),[8484,8485),[8486,8487),[8488,8489),[8490,8494),[8495,8501),[8505,8506),[8508,8512),[8517,8522),[8526,8527),[8544,8576),[8579,8581),[9398,9450),[11264,11493),[11499,11503),[11506,11508),[11520,11558),[11559,11560),[11565,11566),[42560,42606),[42624,42654),[42786,42888),[42891,42895),[42896,42973),[42993,42999),[43000,43003),[43824,43867),[43868,43882),[43888,43968),[64256,64263),[64275,64280),[65313,65339),[65345,65371),[66560,66640),[66736,66772),[66776,66812),[66928,66939),[66940,66955),[66956,66963),[66964,66966),[66967,66978),[66979,66994),[66995,67002),[67003,67005),[67456,67457),[67459,67462),[67463,67505),[67506,67515),[68736,68787),[68800,68851),[68944,68966),[68976,68998),[71840,71904),[93760,93824),[93856,93881),[93883,93908),[119808,119893),[119894,119965),[119966,119968),[119970,119971),[119973,119975),[119977,119981),[119982,119994),[119995,119996),[119997,120004),[120005,120070),[120071,120075),[120077,120085),[120086,120093),[120094,120122),[120123,120127),[120128,120133),[120134,120135),[120138,120145),[120146,120486),[120488,120513),[120514,120539),[120540,120571),[120572,120597),[120598,120629),[120630,120655),[120656,120687),[120688,120713),[120714,120745),[120746,120771),[120772,120780),[122624,122634),[122635,122655),[122661,122667),[122928,122990),[125184,125252),[127280,127306),[127312,127338),[127344,127370)}'::int4multirange;
  ignorable int4multirange:='{[39,40),[46,47),[58,59),[94,95),[96,97),[168,169),[173,174),[175,176),[180,181),[183,185),[688,880),[884,886),[890,891),[900,902),[903,904),[1155,1162),[1369,1370),[1375,1376),[1425,1470),[1471,1472),[1473,1475),[1476,1478),[1479,1480),[1524,1525),[1536,1542),[1552,1563),[1564,1565),[1600,1601),[1611,1632),[1648,1649),[1750,1758),[1759,1769),[1770,1774),[1807,1808),[1809,1810),[1840,1867),[1958,1969),[2027,2038),[2042,2043),[2045,2046),[2070,2094),[2137,2140),[2184,2185),[2192,2194),[2199,2208),[2249,2307),[2362,2363),[2364,2365),[2369,2377),[2381,2382),[2385,2392),[2402,2404),[2417,2418),[2433,2434),[2492,2493),[2497,2501),[2509,2510),[2530,2532),[2558,2559),[2561,2563),[2620,2621),[2625,2627),[2631,2633),[2635,2638),[2641,2642),[2672,2674),[2677,2678),[2689,2691),[2748,2749),[2753,2758),[2759,2761),[2765,2766),[2786,2788),[2810,2816),[2817,2818),[2876,2877),[2879,2880),[2881,2885),[2893,2894),[2901,2903),[2914,2916),[2946,2947),[3008,3009),[3021,3022),[3072,3073),[3076,3077),[3132,3133),[3134,3137),[3142,3145),[3146,3150),[3157,3159),[3170,3172),[3201,3202),[3260,3261),[3263,3264),[3270,3271),[3276,3278),[3298,3300),[3328,3330),[3387,3389),[3393,3397),[3405,3406),[3426,3428),[3457,3458),[3530,3531),[3538,3541),[3542,3543),[3633,3634),[3636,3643),[3654,3663),[3761,3762),[3764,3773),[3782,3783),[3784,3791),[3864,3866),[3893,3894),[3895,3896),[3897,3898),[3953,3967),[3968,3973),[3974,3976),[3981,3992),[3993,4029),[4038,4039),[4141,4145),[4146,4152),[4153,4155),[4157,4159),[4184,4186),[4190,4193),[4209,4213),[4226,4227),[4229,4231),[4237,4238),[4253,4254),[4348,4349),[4957,4960),[5906,5909),[5938,5940),[5970,5972),[6002,6004),[6068,6070),[6071,6078),[6086,6087),[6089,6100),[6103,6104),[6109,6110),[6155,6160),[6211,6212),[6277,6279),[6313,6314),[6432,6435),[6439,6441),[6450,6451),[6457,6460),[6679,6681),[6683,6684),[6742,6743),[6744,6751),[6752,6753),[6754,6755),[6757,6765),[6771,6781),[6783,6784),[6823,6824),[6832,6878),[6880,6892),[6912,6916),[6964,6965),[6966,6971),[6972,6973),[6978,6979),[7019,7028),[7040,7042),[7074,7078),[7080,7082),[7083,7086),[7142,7143),[7144,7146),[7149,7150),[7151,7154),[7212,7220),[7222,7224),[7288,7294),[7376,7379),[7380,7393),[7394,7401),[7405,7406),[7412,7413),[7416,7418),[7468,7531),[7544,7545),[7579,7680),[8125,8126),[8127,8130),[8141,8144),[8157,8160),[8173,8176),[8189,8191),[8203,8208),[8216,8218),[8228,8229),[8231,8232),[8234,8239),[8288,8293),[8294,8304),[8305,8306),[8319,8320),[8336,8349),[8400,8433),[11388,11390),[11503,11506),[11631,11632),[11647,11648),[11744,11776),[11823,11824),[12293,12294),[12330,12334),[12337,12342),[12347,12348),[12441,12447),[12540,12543),[40981,40982),[42232,42238),[42508,42509),[42607,42611),[42612,42622),[42623,42624),[42652,42656),[42736,42738),[42752,42786),[42864,42865),[42888,42891),[42993,42997),[43000,43002),[43010,43011),[43014,43015),[43019,43020),[43045,43047),[43052,43053),[43204,43206),[43232,43250),[43263,43264),[43302,43310),[43335,43346),[43392,43395),[43443,43444),[43446,43450),[43452,43454),[43471,43472),[43493,43495),[43561,43567),[43569,43571),[43573,43575),[43587,43588),[43596,43597),[43632,43633),[43644,43645),[43696,43697),[43698,43701),[43703,43705),[43710,43712),[43713,43714),[43741,43742),[43756,43758),[43763,43765),[43766,43767),[43867,43872),[43881,43884),[44005,44006),[44008,44009),[44013,44014),[64286,64287),[64434,64451),[65024,65040),[65043,65044),[65056,65072),[65106,65107),[65109,65110),[65279,65280),[65287,65288),[65294,65295),[65306,65307),[65342,65343),[65344,65345),[65392,65393),[65438,65440),[65507,65508),[65529,65532),[66045,66046),[66272,66273),[66422,66427),[67456,67462),[67463,67505),[67506,67515),[68097,68100),[68101,68103),[68108,68112),[68152,68155),[68159,68160),[68325,68327),[68900,68904),[68942,68943),[68969,68974),[68975,68976),[69291,69293),[69317,69318),[69370,69376),[69446,69457),[69506,69510),[69633,69634),[69688,69703),[69744,69745),[69747,69749),[69759,69762),[69811,69815),[69817,69819),[69821,69822),[69826,69827),[69837,69838),[69888,69891),[69927,69932),[69933,69941),[70003,70004),[70016,70018),[70070,70079),[70089,70093),[70095,70096),[70191,70194),[70196,70197),[70198,70200),[70206,70207),[70209,70210),[70367,70368),[70371,70379),[70400,70402),[70459,70461),[70464,70465),[70502,70509),[70512,70517),[70587,70593),[70606,70607),[70608,70609),[70610,70611),[70625,70627),[70712,70720),[70722,70725),[70726,70727),[70750,70751),[70835,70841),[70842,70843),[70847,70849),[70850,70852),[71090,71094),[71100,71102),[71103,71105),[71132,71134),[71219,71227),[71229,71230),[71231,71233),[71339,71340),[71341,71342),[71344,71350),[71351,71352),[71453,71454),[71455,71456),[71458,71462),[71463,71468),[71727,71736),[71737,71739),[71995,71997),[71998,71999),[72003,72004),[72148,72152),[72154,72156),[72160,72161),[72193,72203),[72243,72249),[72251,72255),[72263,72264),[72273,72279),[72281,72284),[72330,72343),[72344,72346),[72544,72545),[72546,72549),[72550,72551),[72752,72759),[72760,72766),[72767,72768),[72850,72872),[72874,72881),[72882,72884),[72885,72887),[73009,73015),[73018,73019),[73020,73022),[73023,73030),[73031,73032),[73104,73106),[73109,73110),[73111,73112),[73177,73178),[73459,73461),[73472,73474),[73526,73531),[73536,73537),[73538,73539),[73562,73563),[78896,78913),[78919,78934),[90398,90410),[90413,90416),[92912,92917),[92976,92983),[92992,92996),[93504,93507),[93547,93549),[94031,94032),[94095,94112),[94176,94178),[94179,94181),[94194,94196),[110576,110580),[110581,110588),[110589,110591),[113821,113823),[113824,113828),[118528,118574),[118576,118599),[119143,119146),[119155,119171),[119173,119180),[119210,119214),[119362,119365),[121344,121399),[121403,121453),[121461,121462),[121476,121477),[121499,121504),[121505,121520),[122880,122887),[122888,122905),[122907,122914),[122915,122917),[122918,122923),[122928,122990),[123023,123024),[123184,123198),[123566,123567),[123628,123632),[124139,124144),[124398,124400),[124643,124644),[124646,124647),[124654,124656),[124661,124662),[124671,124672),[125136,125143),[125252,125260),[127995,128000),[917505,917506),[917536,917632),[917760,918000)}'::int4multirange;
  characters text[]:=regexp_split_to_array(value,''); result text:=''; character text;
  preceding_cased boolean:=false; following_cased boolean; point integer; look integer;
begin
  for index in 1..coalesce(array_length(characters,1),0) loop
    character:=characters[index]; point:=ascii(character);
    if character='Σ' and preceding_cased then
      following_cased:=false; look:=index+1;
      while look<=array_length(characters,1) loop
        if not (ascii(characters[look]) <@ ignorable) then
          following_cased:=ascii(characters[look]) <@ cased; exit;
        end if;
        look:=look+1;
      end loop;
      result:=result||case when following_cased then 'σ' else 'ς' end;
    else result:=result||replace(translate(character,'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǅǇǈǊǋǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǲǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎͰͲͶͿΆΈΉΊΌΎΏΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫϏϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽϾϿЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖႠႡႢႣႤႥႦႧႨႩႪႫႬႭႮႯႰႱႲႳႴႵႶႷႸႹႺႻႼႽႾႿჀჁჂჃჄჅჇჍᎠᎡᎢᎣᎤᎥᎦᎧᎨᎩᎪᎫᎬᎭᎮᎯᎰᎱᎲᎳᎴᎵᎶᎷᎸᎹᎺᎻᎼᎽᎾᎿᏀᏁᏂᏃᏄᏅᏆᏇᏈᏉᏊᏋᏌᏍᏎᏏᏐᏑᏒᏓᏔᏕᏖᏗᏘᏙᏚᏛᏜᏝᏞᏟᏠᏡᏢᏣᏤᏥᏦᏧᏨᏩᏪᏫᏬᏭᏮᏯᏰᏱᏲᏳᏴᏵᲉᲐᲑᲒᲓᲔᲕᲖᲗᲘᲙᲚᲛᲜᲝᲞᲟᲠᲡᲢᲣᲤᲥᲦᲧᲨᲩᲪᲫᲬᲭᲮᲯᲰᲱᲲᲳᲴᲵᲶᲷᲸᲹᲺᲽᲾᲿḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾸᾹᾺΆᾼῈΈῊΉῌῘῙῚΊῨῩῪΎῬῸΌῺΏῼΩKÅℲⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯↃⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⰀⰁⰂⰃⰄⰅⰆⰇⰈⰉⰊⰋⰌⰍⰎⰏⰐⰑⰒⰓⰔⰕⰖⰗⰘⰙⰚⰛⰜⰝⰞⰟⰠⰡⰢⰣⰤⰥⰦⰧⰨⰩⰪⰫⰬⰭⰮⰯⱠⱢⱣⱤⱧⱩⱫⱭⱮⱯⱰⱲⱵⱾⱿⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪꞫꞬꞭꞮꞰꞱꞲꞳꞴꞶꞸꞺꞼꞾꟀꟂꟄꟅꟆꟇꟉꟋꟌ꟎Ꟑ꟒꟔ꟖꟘꟚꟜꟵＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇𐐈𐐉𐐊𐐋𐐌𐐍𐐎𐐏𐐐𐐑𐐒𐐓𐐔𐐕𐐖𐐗𐐘𐐙𐐚𐐛𐐜𐐝𐐞𐐟𐐠𐐡𐐢𐐣𐐤𐐥𐐦𐐧𐒰𐒱𐒲𐒳𐒴𐒵𐒶𐒷𐒸𐒹𐒺𐒻𐒼𐒽𐒾𐒿𐓀𐓁𐓂𐓃𐓄𐓅𐓆𐓇𐓈𐓉𐓊𐓋𐓌𐓍𐓎𐓏𐓐𐓑𐓒𐓓𐕰𐕱𐕲𐕳𐕴𐕵𐕶𐕷𐕸𐕹𐕺𐕼𐕽𐕾𐕿𐖀𐖁𐖂𐖃𐖄𐖅𐖆𐖇𐖈𐖉𐖊𐖌𐖍𐖎𐖏𐖐𐖑𐖒𐖔𐖕𐲀𐲁𐲂𐲃𐲄𐲅𐲆𐲇𐲈𐲉𐲊𐲋𐲌𐲍𐲎𐲏𐲐𐲑𐲒𐲓𐲔𐲕𐲖𐲗𐲘𐲙𐲚𐲛𐲜𐲝𐲞𐲟𐲠𐲡𐲢𐲣𐲤𐲥𐲦𐲧𐲨𐲩𐲪𐲫𐲬𐲭𐲮𐲯𐲰𐲱𐲲𐵐𐵑𐵒𐵓𐵔𐵕𐵖𐵗𐵘𐵙𐵚𐵛𐵜𐵝𐵞𐵟𐵠𐵡𐵢𐵣𐵤𐵥𑢠𑢡𑢢𑢣𑢤𑢥𑢦𑢧𑢨𑢩𑢪𑢫𑢬𑢭𑢮𑢯𑢰𑢱𑢲𑢳𑢴𑢵𑢶𑢷𑢸𑢹𑢺𑢻𑢼𑢽𑢾𑢿𖹀𖹁𖹂𖹃𖹄𖹅𖹆𖹇𖹈𖹉𖹊𖹋𖹌𖹍𖹎𖹏𖹐𖹑𖹒𖹓𖹔𖹕𖹖𖹗𖹘𖹙𖹚𖹛𖹜𖹝𖹞𖹟𖺠𖺡𖺢𖺣𖺤𖺥𖺦𖺧𖺨𖺩𖺪𖺫𖺬𖺭𖺮𖺯𖺰𖺱𖺲𖺳𖺴𖺵𖺶𖺷𖺸𞤀𞤁𞤂𞤃𞤄𞤅𞤆𞤇𞤈𞤉𞤊𞤋𞤌𞤍𞤎𞤏𞤐𞤑𞤒𞤓𞤔𞤕𞤖𞤗𞤘𞤙𞤚𞤛𞤜𞤝𞤞𞤟𞤠𞤡','abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǆǉǉǌǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏͱͳͷϳάέήίόύώαβγδεζηθικλμνξοπρστυφχψωϊϋϗϙϛϝϟϡϣϥϧϩϫϭϯθϸϲϻͻͼͽѐёђѓєѕіїјљњћќѝўџабвгдежзийклмнопрстуфхцчшщъыьэюяѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӏӂӄӆӈӊӌӎӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥⴧⴭꭰꭱꭲꭳꭴꭵꭶꭷꭸꭹꭺꭻꭼꭽꭾꭿꮀꮁꮂꮃꮄꮅꮆꮇꮈꮉꮊꮋꮌꮍꮎꮏꮐꮑꮒꮓꮔꮕꮖꮗꮘꮙꮚꮛꮜꮝꮞꮟꮠꮡꮢꮣꮤꮥꮦꮧꮨꮩꮪꮫꮬꮭꮮꮯꮰꮱꮲꮳꮴꮵꮶꮷꮸꮹꮺꮻꮼꮽꮾꮿᏸᏹᏺᏻᏼᏽᲊაბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰჱჲჳჴჵჶჷჸჹჺჽჾჿḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱὰάᾳὲέὴήῃῐῑὶίῠῡὺύῥὸόὼώῳωkåⅎⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⰰⰱⰲⰳⰴⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱟⱡɫᵽɽⱨⱪⱬɑɱɐɒⱳⱶȿɀⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳬⳮⳳꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝺꝼᵹꝿꞁꞃꞅꞇꞌɥꞑꞓꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩɦɜɡɬɪʞʇʝꭓꞵꞷꞹꞻꞽꞿꟁꟃꞔʂᶎꟈꟊɤꟍ꟏ꟑꟓꟕꟗꟙꟛƛꟶａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱𐐲𐐳𐐴𐐵𐐶𐐷𐐸𐐹𐐺𐐻𐐼𐐽𐐾𐐿𐑀𐑁𐑂𐑃𐑄𐑅𐑆𐑇𐑈𐑉𐑊𐑋𐑌𐑍𐑎𐑏𐓘𐓙𐓚𐓛𐓜𐓝𐓞𐓟𐓠𐓡𐓢𐓣𐓤𐓥𐓦𐓧𐓨𐓩𐓪𐓫𐓬𐓭𐓮𐓯𐓰𐓱𐓲𐓳𐓴𐓵𐓶𐓷𐓸𐓹𐓺𐓻𐖗𐖘𐖙𐖚𐖛𐖜𐖝𐖞𐖟𐖠𐖡𐖣𐖤𐖥𐖦𐖧𐖨𐖩𐖪𐖫𐖬𐖭𐖮𐖯𐖰𐖱𐖳𐖴𐖵𐖶𐖷𐖸𐖹𐖻𐖼𐳀𐳁𐳂𐳃𐳄𐳅𐳆𐳇𐳈𐳉𐳊𐳋𐳌𐳍𐳎𐳏𐳐𐳑𐳒𐳓𐳔𐳕𐳖𐳗𐳘𐳙𐳚𐳛𐳜𐳝𐳞𐳟𐳠𐳡𐳢𐳣𐳤𐳥𐳦𐳧𐳨𐳩𐳪𐳫𐳬𐳭𐳮𐳯𐳰𐳱𐳲𐵰𐵱𐵲𐵳𐵴𐵵𐵶𐵷𐵸𐵹𐵺𐵻𐵼𐵽𐵾𐵿𐶀𐶁𐶂𐶃𐶄𐶅𑣀𑣁𑣂𑣃𑣄𑣅𑣆𑣇𑣈𑣉𑣊𑣋𑣌𑣍𑣎𑣏𑣐𑣑𑣒𑣓𑣔𑣕𑣖𑣗𑣘𑣙𑣚𑣛𑣜𑣝𑣞𑣟𖹠𖹡𖹢𖹣𖹤𖹥𖹦𖹧𖹨𖹩𖹪𖹫𖹬𖹭𖹮𖹯𖹰𖹱𖹲𖹳𖹴𖹵𖹶𖹷𖹸𖹹𖹺𖹻𖹼𖹽𖹾𖹿𖺻𖺼𖺽𖺾𖺿𖻀𖻁𖻂𖻃𖻄𖻅𖻆𖻇𖻈𖻉𖻊𖻋𖻌𖻍𖻎𖻏𖻐𖻑𖻒𖻓𞤢𞤣𞤤𞤥𞤦𞤧𞤨𞤩𞤪𞤫𞤬𞤭𞤮𞤯𞤰𞤱𞤲𞤳𞤴𞤵𞤶𞤷𞤸𞤹𞤺𞤻𞤼𞤽𞤾𞤿𞥀𞥁𞥂𞥃'),'İ','i̇'); end if;
    if not (point <@ ignorable) then preceding_cased:=point <@ cased; end if;
  end loop;
  return result;
end $$;

-- Pure, domain-independent value comparison; consumes the existing validated
-- catalog, never SQL expressions from a definition. NULL negative comparisons
-- fail closed, exactly as in the Stage 1 evaluator.
create function private.automation_compare(actual jsonb,expected jsonb,operator text,spec jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare empty_value boolean; matched boolean; left_value numeric; right_value numeric;
begin
  empty_value:=actual='null'::jsonb or (jsonb_typeof(actual)='string' and private.automation_trim(actual#>>'{}')='') or actual='[]'::jsonb;
  if operator='is_empty' then return empty_value; end if;
  if operator='is_not_empty' then return not empty_value; end if;
  if actual='null'::jsonb or actual is null then return false; end if;
  if operator in ('in','not_in') then
    select exists(select 1 from jsonb_array_elements(expected) v where private.automation_compare(actual,v,'equals',spec)) into matched;
    return case when operator='in' then matched else not matched end;
  end if;
  if spec->>'kind' in ('string','reference') then
    actual:=to_jsonb(private.automation_lower(actual#>>'{}')); expected:=to_jsonb(private.automation_lower(expected#>>'{}'));
  end if;
  case operator
    when 'equals' then return actual=expected;
    when 'not_equals' then return actual<>expected;
    when 'contains','not_contains' then
      matched:=case when jsonb_typeof(actual)='string' then strpos(actual#>>'{}',expected#>>'{}')>0 else actual @> jsonb_build_array(expected) end;
      return case when operator='contains' then matched else not matched end;
    when 'greater_than','less_than' then
      if spec->>'kind'='enum' then
        select ordinality into left_value from jsonb_array_elements(spec->'values') with ordinality v where v.value=actual;
        select ordinality into right_value from jsonb_array_elements(spec->'values') with ordinality v where v.value=expected;
      else left_value:=(actual#>>'{}')::numeric; right_value:=(expected#>>'{}')::numeric; end if;
      return case when operator='greater_than' then left_value>right_value else left_value<right_value end;
    else return false;
  end case;
end $$;
-- Snapshot nullability belongs to the registered adapter. The Stage 2 catalog
-- intentionally describes definition values, which are never nullable.
create function private.automation_snapshot_value_valid(entity_type text,field text,value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare spec jsonb:=private.automation_definition_catalog()#>array['fields',entity_type||':'||field,'value'];
begin
  if value is null or spec is null then return false; end if;
  if value<>'null'::jsonb then return coalesce(private.automation_value_valid(value,spec),false); end if;
  case entity_type
    when 'ticket' then return field in ('category_id','subcategory_id','assigned_technician_id','team_id','requester_department_id','location_id');
    else return false;
  end case;
end $$;
create function private.automation_condition_results(definition jsonb,snapshot jsonb,entity_type text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare item jsonb; spec jsonb; actual jsonb; result jsonb:='[]'; status text; detail jsonb;
begin
  for item in select * from jsonb_array_elements(definition#>'{conditions,children}') loop
    spec:=private.automation_definition_catalog()#>array['fields',entity_type||':'||(item->>'field')]; actual:=snapshot->(item->>'field');
    if not private.automation_snapshot_value_valid(entity_type,item->>'field',actual) then status:='error';
    elsif coalesce(private.automation_compare(actual,item->'value',item->>'operator',spec->'value'),false) then status:='passed'; else status:='failed'; end if;
    detail:=jsonb_build_object('id',item->>'id','field',item->>'field','operator',item->>'operator','status',status);
    if status='error' then detail:=detail||jsonb_build_object('error',jsonb_build_object('code','invalid_context','message','The event is missing a valid value for this field.')); end if;
    result:=result||jsonb_build_array(detail);
  end loop;
  return result;
end $$;

-- Adapter dispatch is application-owned. Extend this dispatcher for a future
-- domain; the generic execution storage/conditions/claims need not change.
create function private.automation_ticket_event_compatible(event private.domain_events) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text; fields text[];
begin
  if event.entity_type<>'ticket' or event.schema_version<>1 then return false; end if;
  fields:=case event.event_type when 'ticket.created' then array['status','priority','requester_id'] when 'ticket.assigned' then array['assigned_technician_id','team_id'] when 'ticket.priority_changed' then array['priority'] when 'ticket.updated' then array[]::text[] else array['status'] end;
  foreach field in array fields loop
    if not private.automation_snapshot_value_valid('ticket',field,event.after_snapshot->field) then return false; end if;
    if event.event_type<>'ticket.created' and not private.automation_snapshot_value_valid('ticket',field,event.before_snapshot->field) then return false; end if;
  end loop;
  case event.event_type
    when 'ticket.created' then return event.before_snapshot is null;
    when 'ticket.updated' then
      if event.before_snapshot is null then return false; end if;
      foreach field in array event.changed_fields loop
        if field=any(array['priority','status','title','category_id','subcategory_id','assigned_technician_id','team_id','requester_id','location_id','description','due_at','first_response_at'])
          and (not event.before_snapshot?field or not event.after_snapshot?field or event.before_snapshot->field is distinct from event.after_snapshot->field) then return true; end if;
      end loop;
      return false;
    when 'ticket.assigned' then
      foreach field in array array['assigned_technician_id','team_id'] loop
        if field=any(event.changed_fields) and event.after_snapshot->field<>'null'::jsonb and event.before_snapshot->field is distinct from event.after_snapshot->field then return true; end if;
      end loop;
      return false;
    when 'ticket.status_changed','ticket.resolved' then
      return event.before_snapshot is not null and 'status'=any(event.changed_fields) and event.before_snapshot->'status'<>event.after_snapshot->'status'
        and (event.event_type<>'ticket.resolved' or (event.before_snapshot->>'status' not in ('resolved','closed') and event.after_snapshot->>'status' in ('resolved','closed')));
    when 'ticket.priority_changed' then return event.before_snapshot is not null and 'priority'=any(event.changed_fields) and event.before_snapshot->'priority'<>event.after_snapshot->'priority';
    else return false;
  end case;
end $$;
create function private.automation_event_compatible(event private.domain_events) returns boolean
language sql immutable set search_path='' as $$
  select case event.entity_type when 'ticket' then private.automation_ticket_event_compatible(event) else false end;
$$;

create function private.begin_automation_execution(delivery_id uuid,token uuid,rule_id uuid,rule_version bigint)
returns public.automation_executions language plpgsql security definer set search_path='' as $$
declare delivery private.domain_event_deliveries%rowtype; event private.domain_events%rowtype; rule public.automation_rules%rowtype;
  version public.automation_rule_versions%rowtype; processing private.automation_processing_state%rowtype; chain private.automation_chains%rowtype;
  result public.automation_executions%rowtype; conditions jsonb; passed boolean; stamp timestamptz; version_transaction xid8;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Service required' using errcode='42501'; end if;
  select * into delivery from private.domain_event_deliveries d where d.id=$1 for update;
  if not found or delivery.lease_token is distinct from token or delivery.status<>'leased' or delivery.lease_expires_at<=clock_timestamp() or delivery.consumer<>'automation' then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  select * into event from private.domain_events where id=delivery.event_id and organization_id=delivery.organization_id;
  select * into rule from public.automation_rules r where r.organization_id=event.organization_id and r.id=$3 for share;
  if not found then raise exception 'Automation unavailable' using errcode='42501'; end if;
  select * into result from public.automation_executions e where e.organization_id=event.organization_id and e.event_id=event.id and e.rule_id=$3;
  if found then
    if result.rule_version is distinct from $4 then raise exception 'Pinned version mismatch' using errcode='22023'; end if;
    return result;
  end if;
  select * into processing from private.automation_processing_state for share;
  select * into version from public.automation_rule_versions v where v.organization_id=rule.organization_id and v.rule_id=rule.id and v.version=rule.version;
  select created_transaction into version_transaction from private.automation_version_visibility v where v.organization_id=rule.organization_id and v.rule_id=rule.id and v.version=rule.version;
  -- Strict > excludes equality; event occurrence, never claim time, is used.
  if not processing.active or not rule.enabled or rule.archived_at is not null or rule.version is distinct from $4
    or event.occurred_at<=greatest(processing.activated_at,rule.enabled_at,version.created_at)
    or version_transaction is null
    or not (version_transaction=event.capture_transaction or pg_visible_in_snapshot(version_transaction,event.capture_snapshot))
    or not (processing.activation_transaction=event.capture_transaction or pg_visible_in_snapshot(processing.activation_transaction,event.capture_snapshot))
    or rule.trigger_type<>event.event_type or not coalesce(private.automation_event_compatible(event),false) then
    raise exception 'Event is not eligible for this automation' using errcode='55000';
  end if;
  if event.depth>=8 then raise exception 'Automation chain limit reached' using errcode='54000'; end if;
  insert into private.automation_chains(organization_id,correlation_id) values(event.organization_id,event.correlation_id) on conflict do nothing;
  select * into chain from private.automation_chains c where c.organization_id=event.organization_id and c.correlation_id=event.correlation_id for update;
  if chain.execution_count>=32 or exists(select 1 from private.automation_chain_claims c where c.organization_id=event.organization_id and c.correlation_id=event.correlation_id and c.rule_id=rule.id and c.entity_type=event.entity_type and c.entity_id=event.entity_id) then
    raise exception 'Automation chain already claimed or exhausted' using errcode='54000';
  end if;
  if delivery.lease_expires_at<=clock_timestamp() then raise exception 'Delivery lease unavailable' using errcode='42501'; end if;
  conditions:=private.automation_condition_results(version.definition,event.after_snapshot,event.entity_type);
  passed:=not exists(select 1 from jsonb_array_elements(conditions) c where c->>'status'<>'passed');
  stamp:=clock_timestamp();
  insert into public.automation_executions(organization_id,rule_id,rule_version,rule_name,event_id,delivery_id,trigger_type,entity_type,entity_id,correlation_id,causation_id,root_event_id,depth,processing_generation,expected_entity_revision,status,conditions,started_at,completed_at)
  values(event.organization_id,rule.id,version.version,version.definition->>'name',event.id,delivery.id,event.event_type,event.entity_type,event.entity_id,event.correlation_id,event.causation_id,event.root_event_id,event.depth,processing.generation,event.entity_version,case when passed then 'running' else 'skipped' end,conditions,stamp,case when passed then null else stamp end) returning * into result;
  insert into public.automation_execution_steps(organization_id,execution_id,action_id,action_type,position,status)
  select result.organization_id,result.id,a->>'id',a->>'type',(a->>'position')::integer,case when passed then 'pending' else 'not_attempted' end from jsonb_array_elements(version.definition->'actions') a;
  insert into private.automation_chain_claims values(event.organization_id,event.correlation_id,rule.id,event.entity_type,event.entity_id,result.id);
  update private.automation_chains c set execution_count=execution_count+1 where c.organization_id=event.organization_id and c.correlation_id=event.correlation_id;
  return result;
end $$;
create function public.begin_automation_execution(delivery_id uuid,token uuid,rule_id uuid,rule_version bigint)
returns public.automation_executions language sql security invoker set search_path='' as $$ select private.begin_automation_execution(delivery_id,token,rule_id,rule_version); $$;

revoke all on function private.automation_lower(text),private.set_automation_processing(boolean),private.automation_compare(jsonb,jsonb,text,jsonb),private.automation_condition_results(jsonb,jsonb,text),private.automation_event_compatible(private.domain_events),private.begin_automation_execution(uuid,uuid,uuid,bigint),public.begin_automation_execution(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function private.begin_automation_execution(uuid,uuid,uuid,bigint),public.begin_automation_execution(uuid,uuid,uuid,bigint) to service_role;
revoke all on function private.automation_snapshot_value_valid(text,text,jsonb),private.automation_ticket_event_compatible(private.domain_events) from public,anon,authenticated,service_role;
revoke all on function private.record_automation_version_visibility() from public,anon,authenticated,service_role;
