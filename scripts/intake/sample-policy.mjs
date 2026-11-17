/** 维护者证据和云填报分级；不产生数据库写入。 */
export const WINDOW_MS = 30 * 86400000;
export const POLICY = 'price-evidence-v1';
const median = a => { const s=[...a].sort((x,y)=>x-y); return s.length ? (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2 : null; };
const norm = s => String(s??'').toLowerCase().replace(/[\s_-]/g,'');
export function qualityIssue(d) {
  if (!d || !d.category || !d.model || !d.chip || !d.channel || typeof d.useSubsidy !== 'boolean') return '配置/渠道/补贴信息不完整';
  if (!['new','used'].includes(d.buyTiming)) return '新旧口径不明确';
  if (/mac|iphone|ipad/i.test(d.category) && !(Number.isFinite(d.memoryGb)&&d.memoryGb>0&&Number.isFinite(d.storageGb)&&d.storageGb>0)) return '内存/存储不完整';
  const model=norm(d.model), chip=norm(d.chip), mac=String(d.model).match(/(?:^|[ _])(M\d+(?:[ _]?(?:Pro|Max|Ultra))?)(?=[ _]|$)/i);
  if (mac && norm(mac[1])!==chip) return '型号与芯片冲突';
  const phone=model.match(/iphone(1[2-8])(pro)?/);
  if (phone) { const gen=Number(phone[1]); const expected=gen<=13?`a${gen+2}`:gen===14?(phone[2]?'a16':'a15'):gen===15?(phone[2]?'a17pro':'a16'):`a${gen+2}${phone[2]?'pro':''}`; if(chip!==expected)return '型号与芯片冲突'; }
  return null;
}
export function gradeEvidence(samples, dimensions, now=Date.now()) {
  const issue=qualityIssue(dimensions);
  const distinct=new Map(); let rejected=0;
  for(const s of samples){
    if(!Number.isFinite(s.observedAt)||s.observedAt>now||now-s.observedAt>WINDOW_MS||!s.sourceKey||!Number.isFinite(s.price)||s.price<=0){rejected++;continue;}
    const k=s.kind+':'+s.sourceKey, prev=distinct.get(k);
    if(!prev||s.observedAt>prev.observedAt)distinct.set(k,s);
  }
  const values=[...distinct.values()];
  const base={policy:POLICY,eligible:false,tier:'线索',confidence:'低',count:0,median:null,madRatio:null,cv:null,rejected,recentCount:values.length};
  if(issue)return {...base,reason:issue};
  let fallback={...base,reason:values.length?'无合格成交证据或填报样本不足':'无近期独立样本'};
  for(const kind of ['official','verified_paid','user_report']){
    const prices=values.filter(x=>x.kind===kind).map(x=>x.price);if(!prices.length)continue;
    const med=median(prices),avg=prices.reduce((a,b)=>a+b,0)/prices.length;
    const madRatio=median(prices.map(x=>Math.abs(x-med)))/med;
    const cv=Math.sqrt(prices.reduce((a,b)=>a+(b-avg)**2,0)/prices.length)/avg;
    const enough=kind!=='user_report'||prices.length>=5, concentrated=madRatio<=.15&&cv<=.4;
    const tier=kind==='official'?'官方价建议':kind==='verified_paid'?(prices.length>=3?'成交参考':'单样本参考'):'填报候选（须外部核验）';
    const g={...base,kind,count:prices.length,median:med,madRatio,cv,tier,confidence:kind==='official'?'高':kind==='verified_paid'&&prices.length>=3?'中':'低',eligible:enough&&concentrated,reason:!enough?`近期独立填报不足(${prices.length}/5)`:!concentrated?'价格离散过大':'待人工复核'};
    if(g.eligible)return g;
    if(fallback.count===0)fallback=g;
  }
  return fallback;
}
// 仅供维护者本地文件使用；云记录永远不经过此可信入口。
export function validateReviewedSamples(rows) {
  if(!Array.isArray(rows))throw new Error('审核样本须为数组');
  return rows.map((s,i)=>{
    const issue=qualityIssue(s.dimensions);
    let url;try{url=new URL(s.evidenceUrl);}catch{}
    if(issue||s.region!=='CN'||s.currency!=='CNY'||s.reviewed!==true||!['official','verified_paid','listing'].includes(s.kind)||!url||url.protocol!=='https:'||typeof s.sourceKey!=='string'||!s.sourceKey.trim()||!Number.isFinite(s.price)||s.price<=0||!Number.isFinite(s.observedAt))throw new Error(`审核样本${i+1}无效：${issue??'证据/日期/来源不完整'}`);
    if(s.kind==='official'&&(!/(^|\.)apple\.com\.cn$/.test(url.hostname)||!['官方','官网'].includes(s.dimensions.channel)||s.dimensions.buyTiming!=='new'||s.dimensions.useSubsidy!==false))throw new Error(`审核样本${i+1}不是同口径中国大陆官方价`);
    return s;
  });
}
export function recentGroups(records, reviewed, {dimensionsOf,skipReason,now=Date.now()}) {
  const groups=new Map(), byIdentity=new Map();
  const add=(d,s)=>{const key=JSON.stringify(d);if(!groups.has(key))groups.set(key,{dimensions:d,samples:[]});groups.get(key).samples.push(s);};
  for(const rec of records){
    if(skipReason(rec))continue;
    const grouped=new Map();
    for(const p of rec.submittedPlans){const d=dimensionsOf(p,rec.params.category),key=JSON.stringify(d);if(!grouped.has(key))grouped.set(key,{d,prices:new Set()});grouped.get(key).prices.add(p.buyPrice);}
    for(const [key,{d,prices}]of grouped){
      // 缺少身份时保留为不达标线索，不能把记录ID当成独立买家。
      if(typeof rec.anonId!=='string'||!rec.anonId){add(d,{kind:'user_report',price:median([...prices]),observedAt:rec.createdAt,sourceKey:null});continue;}
      if(!Number.isFinite(rec.createdAt)||rec.createdAt>now||now-rec.createdAt>WINDOW_MS){add(d,{kind:'user_report',price:median([...prices]),observedAt:rec.createdAt,sourceKey:rec.anonId});continue;}
      const id=key+':'+rec.anonId,prev=byIdentity.get(id);
      if(!prev||rec.createdAt>prev.observedAt||(rec.createdAt===prev.observedAt&&rec._id>prev.id))byIdentity.set(id,{d,id:rec._id,kind:'user_report',price:median([...prices]),observedAt:rec.createdAt,sourceKey:rec.anonId});
    }
  }
  for(const s of byIdentity.values())add(s.d,s);
  for(const s of reviewed)add(dimensionsOf(s.dimensions,s.dimensions.category),s);
  return groups;
}
