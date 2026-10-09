export function TimezoneSelect({ value, personal = false }: { value: string; personal?: boolean }) {
  const zones = Array.from(new Set(['UTC', ...Intl.supportedValuesOf('timeZone'), ...(value ? [value] : [])])).sort();
  return <label className="field">{personal ? 'Display timezone' : 'Organization timezone'}<select className="input" name="timezone" defaultValue={value} required={!personal}>{personal && <option value="">Follow my device</option>}{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></label>;
}
