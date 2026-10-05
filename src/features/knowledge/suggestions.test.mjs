import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestArticles } from './suggestions.ts';
const guides = [
 {id:'wifi',title:'Connect to Wi-Fi',summary:'Check your wireless connection.',category:'Network'},
 {id:'password',title:'Reset a password',summary:'Recover access to your account.',category:'Accounts'},
 {id:'printer',title:'Printer troubleshooting',summary:'Resolve printing issues.',category:'Hardware'},
];
test('suggestions match issue words and normalize Wi-Fi spelling',()=>{
 assert.equal(suggestArticles(guides,'I cannot connect to wifi','')[0].id,'wifi');
 assert.equal(suggestArticles(guides,'Forgot passwords','')[0].id,'password');
});
test('category selection produces relevant guides without forcing a match for empty or unrelated text',()=>{
 assert.equal(suggestArticles(guides,'','Network')[0].id,'wifi');
 assert.deepEqual(suggestArticles(guides,'Please help with my problem',''),[]);
 assert.deepEqual(suggestArticles(guides,'unrelated ostrich',''),[]);
 assert.deepEqual(suggestArticles([], 'wifi', 'Network'),[]);
});
test('suggestions are limited to three and ties are deterministic',()=>{
 const articles=Array.from({length:6},(_,n)=>({id:String(n),title:`Network ${n}`,summary:'Network',category:'Network'}));
 assert.deepEqual(suggestArticles(articles.reverse(),'network','').map(a=>a.id),['0','1','2']);
});
test('specific Wi-Fi matches rank above generic connection guides',()=>{
 const articles=[{id:'vpn',title:'A work service or VPN will not connect',summary:'Check internet.',category:'Network'},{id:'wifi',title:'Troubleshoot Wi-Fi or an unavailable internet connection',summary:'Check your device.',category:'Network'}];
 assert.equal(suggestArticles(articles,'I cannot connect to Wi-Fi','')[0].id,'wifi');
});
