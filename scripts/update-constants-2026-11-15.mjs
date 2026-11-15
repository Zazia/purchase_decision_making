/** 2026-11-15 经核验的数据维护；不把核验日覆盖到旧渠道采样日期。 */
import fs from 'node:fs';
const path='.agents/skills/apple-value-analysis/constants.json';
const d=JSON.parse(fs.readFileSync(path,'utf8'));
if(d.metadata.version!=='4.10') throw new Error('仅适用于 v4.10，避免重复迁移');
fs.mkdirSync('scripts/debug',{recursive:true});
fs.copyFileSync(path,'scripts/debug/constants-before-2026-11-15.json');
const s=d.实时市场价快照, today='2026-11-15', updates=[];
const official=(cat,key,price,url,note='')=>{
 const e=s[cat][key]??={搜索日期:today,置信度:'高(仅官方价；渠道实付与二手成交待采样)',样本量:'官方价1',闲鱼中位价_二手同款:null};
 const old=e.官方价;
 if(old!==undefined && old!==price)e._历史官方价_v4_11={价格:old,来源:e.官方价_来源??null,搜索日期:e.搜索日期??null};
 e.官方价=price;e.官方价_来源=url;e._官方价核验日期=today;e._在售状态='官网在售';
 if(note)e._本次核验说明=note;
 updates.push({品类:cat,机型:key,原官方价:old??null,官方价:price,来源:url});
};
const retire=(cat,key,url)=>{const e=s[cat][key];if(!e)return;e._官网在售核验={日期:today,状态:'官网当前阵容已由后续型号替代；旧官价仅历史值',来源:url};if(e.官方价!=null){e._历史官方价_v4_11={价格:e.官方价,来源:e.官方价_来源??null,搜索日期:e.搜索日期??null};e.官方价=null;}e.官方价_说明='历史官方价已移入 _历史官方价_v4_11，不代表当前可购买官价。';};
official('iPhone_标准','iPhone_17_256G_新品',6799,'https://www.apple.com.cn/shop/buy-iphone/iphone-17');
official('iPhone_标准','iPhone_17_512G_新品',8799,'https://www.apple.com.cn/shop/buy-iphone/iphone-17','旧值7999未跟随调价更新；不同时修改京东历史采样。');
official('Mac_mini','M6_16G_256G_新品',6999,'https://www.apple.com.cn/shop/buy-mac','配置由 Mac mini 购买页核对；当前已在售。');
for(const key of ['M6_16G_256G_新品','M5_Pro_24G_512G_新品']){
 const e=s.Mac_mini[key];e._在售状态='官网在售';e._在售核验日期=today;
 e.京东自营价='无法核实当前京东实付价';e.闲鱼中位价_二手同款='无法核实当前同配置二手成交价';
}
official('MacBook_Air','M5_13寸_16G_512G_新品',9999,'https://www.apple.com.cn/shop/buy-mac','配置由 MacBook Air 购买页核对；旧渠道优惠未续期。');
official('MacBook_Pro','M6_14寸_16G_1024G_新品_基础款',15999,'https://www.apple.com.cn/newsroom/2026/10/apple-introduces-the-new-14-inch-macbook-pro-with-m6/','16GB/1TB基础配置由 https://www.apple.com.cn/macbook-pro/liquid-retina-xdr-display/specs/ 核实；10月27日官宣，11月6日发售。');
official('iMac','M6_24寸_16G_256G_新品',12499,'https://www.apple.com.cn/newsroom/2026/10/apple-unveils-new-imac-with-m6/','10核CPU/10核GPU；16GB/256GB由购买页核对。不能直接套用12核M6跑分，需变体折算。');
official('Mac_Studio','M5Max_36G_512G_新品_基础款',19999,'https://www.apple.com.cn/shop/buy-mac','18核CPU/32核GPU、36GB/512GB由 https://www.apple.com.cn/shop/buy-mac/mac-studio 核对。');
official('iPad_mini','A20_Pro_128G_新品',5499,'https://www.apple.com.cn/shop/buy-ipad/ipad-mini','无线局域网128GB；5核CPU/7核GPU，不能直接套用iPhone 6核A20 Pro跑分。');
official('iPad_mini','A20_Pro_256G_新品',6299,'https://www.apple.com.cn/shop/buy-ipad/ipad-mini','无线局域网256GB标准玻璃；5核CPU/7核GPU，不混用纳米纹理及蜂窝型号价格。');
official('iPad_Pro','M5_11寸_256G_新品',10799,'https://www.apple.com.cn/shop/buy-ipad/ipad-pro','11寸无线局域网256GB/12GB，9核CPU。');
official('iPad_Air','M4_11寸_128G_新品',5999,'https://www.apple.com.cn/shop/buy-ipad/ipad-air');
s.iPad_Air.M4_11寸_128G_新品.闲鱼中位价_二手同款='无法核实当前同配置二手成交价';
official('Apple_Watch','Series_12_42mm_新品',2999,'https://www.apple.com.cn/shop/buy-watch/apple-watch','入门铝金属GPS表款，其他材质、尺寸及蜂窝款单独报价。');
official('Apple_Watch','Ultra_4_49mm_新品',6499,'https://www.apple.com.cn/shop/buy-watch/apple-watch-ultra');
official('Apple_Watch','SE_3_40mm_新品',1999,'https://www.apple.com.cn/shop/buy-watch/apple-watch');
official('AirPods','AirPods_5_新品',999,'https://www.apple.com.cn/shop/buy-airpods/airpods-5');
official('AirPods','AirPods_5_无线充电盒_新品',1149,'https://www.apple.com.cn/shop/buy-airpods/airpods-5');
official('AirPods','AirPods_Pro_3_新品',1899,'https://www.apple.com.cn/shop/buy-airpods/airpods-pro-3');
official('AirPods','AirPods_Max_2_新品',3999,'https://www.apple.com.cn/shop/buy-airpods/airpods-max-2');
official('HomePod','HomePod_2_新品',2699,'https://www.apple.com.cn/shop/buy-homepod/homepod');
official('HomePod','HomePod_mini_2_新品',1099,'https://www.apple.com.cn/shop/buy-homepod/homepod-mini');
for(const [cat,keys,url] of [
 ['MacBook_Pro',['M5_14寸_16G_512G_新品_基础款'],'https://www.apple.com.cn/shop/buy-mac/macbook-pro'],
 ['iMac',['M4_24寸_新品'],'https://www.apple.com.cn/shop/buy-mac/imac'],
 ['Mac_Studio',['M4Max_新品_基础款','M3Ultra_新品_旗舰款'],'https://www.apple.com.cn/shop/buy-mac/mac-studio'],
 ['iPad_mini',['A17_Pro_128G_新品'],'https://www.apple.com.cn/shop/buy-ipad/ipad-mini'],
 ['Apple_Watch',['Series_11_42mm_新品','Ultra_3_49mm_新品'],'https://www.apple.com.cn/watch/'],
 ['AirPods',['AirPods_4_新品','AirPods_4_ANC_新品'],'https://www.apple.com.cn/airpods/'],
 ['HomePod',['HomePod_mini_新品'],'https://www.apple.com.cn/homepod/'],
 ['iPhone_Pro',['iPhone_17_Pro_256G_新品','iPhone_17_Pro_512G_新品','iPhone_17_Pro_1024G_新品'],'https://www.apple.com.cn/shop/buy-iphone'],
 ['iPhone_proMax',['iPhone_17_ProMax_256G_新品','iPhone_17_ProMax_512G_新品','iPhone_17_ProMax_1024G_新品'],'https://www.apple.com.cn/shop/buy-iphone']
])for(const k of keys)retire(cat,k,url);
// 保留无法解析的旧说明，但不把其他渠道折抵上限写作爱回收报价。
let normalized=0,stale=0,total=0;
for(const [cat,entries]of Object.entries(s)){
 if(cat.startsWith('_')||!entries||Array.isArray(entries)||typeof entries!=='object')continue;
 for(const [key,e]of Object.entries(entries)){
  if(key.startsWith('_')||!e||typeof e!=='object')continue;
  total++;
  const days=e.搜索日期?Math.floor((Date.parse(today)-Date.parse(e.搜索日期))/86400000):null;
  e._时效审计=days===null?'无日期，待核实':days>30?'过期，未复采':'30天内；促销价另核';
  if(days===null||days>30)stale++;
  for(const [f,v]of Object.entries(e)){
   if(f.startsWith('_')||!/价$|报价|到手价|中位价/.test(f)||/来源|说明|样本|参考|口径/.test(f)||typeof v!=='string')continue;
   if(!/^[+-]?\d|^(无法|待|用户|注|暂无|—|无|请)/.test(v.trim())){e[f+'_说明']=v;e[f]=null;normalized++;}
  }
 }
}
for(const [cat,detail] of Object.entries({MacBook_Pro:'M6基础款及PROLED XDR高端款已在售，下一代日期待官宣',iMac:'M6已于2026-10-27发布、11-06发售',iPad_mini:'A20 Pro新款已在售',Apple_Watch:'Series 12与Ultra 4已在售',AirPods:'AirPods 5已在售',HomePod:'HomePod mini 2已在售',Apple_TV:'Apple 2026-10-13新闻稿已官宣新Apple TV 4K；海外价格不可当作中国大陆官价',iPad_标准:'原2026-09日期为无独立信源周期外推，已到期，当前新品日期未核实'})){
 const r=d.苹果产品发布节奏[cat];r._历史预测_v4_11=r.下一次预计;r.下一次预计='待官宣';r._核验_v4_11={日期:today,结论:detail};
}
Object.assign(d.产品发布日期,{MacBook_Pro_14_M6:'2026-10',iMac_M6:'2026-10',iPad_mini_A20Pro:'2026-10'});
d.芯片性能跑分.Mac芯片.M6._复核_v4_11='2026-11-15:GB6.7.1单样本 https://browser.geekbench.com/v6/cpu/19234603 为4661/20525；汇总页 https://browser.geekbench.com/macs/mac-mini-2026-12c-cpu-12c-gpu 标注GB6但为4005/21872，单核差异显著。保留原推算值及区间，不冒充新实测均值，不混入GB7。';
d.metadata.version='4.11';d.metadata.last_updated=today;
d.metadata['v4.11_变更摘要']=[`官网核验/新增${updates.length}条官方价；iPhone 17 512GB由7999纠正为8799。`,'补充已在售新品快照；被替代型号官价移入历史字段，不再标为当前官价。',`全量审计${total}条快照，${stale}条原渠道日期超过30天或缺失，保留原日期，不伪装更新；云端55条分享中无达标样本。`,'清理8类过时发布预测；保值率曲线不变，M6跑分冲突保留待核实。',`修正${normalized}处说明混入价格字段；宏观扫描更新至2026-11。`];
s.snapshot_date=today;
s._快照更新说明_v4_11='本日期是维护批次日期，非所有字段采样日期。官价按 _官方价核验日期；历史渠道价按原搜索日期及 _时效审计。缺少合格新成交样本的旧价仍过期。全量时效审计基准日2026-11-15，阈值30天；状态不代表客户端已禁用旧值。';
s._本次云端样本审计={日期:today,分享记录:55,新增记录:8,新增用户价:1,可纳入:0,原因:'样本1/20且型号与芯片冲突；不回写价格。'};
d['宏观因素扩展模型_v3.8']._复核_2026_11_15={来源:'https://www.trendforce.com/presscenter/news/20261111-13303.html',事实:'TrendForce 11月11日预计第四季度PC DRAM合约价环比上行13%-18%，客户端SSD涨幅低于5%；整机库存增加，采购开始调整。',判定:'存储成本压力仍在但需求分化；ongoing为维护者推断，不能据此断言所有苹果机型继续涨价。'};
fs.writeFileSync(path,JSON.stringify(d,null,2)+'\n');
const mp='miniapp/wx/snapshot/macro-context.json',m=JSON.parse(fs.readFileSync(mp,'utf8'));
m.analysisMonth='2026-11';m._更新依据='2026-11-15复核：TrendForce 2026-11-11 https://www.trendforce.com/presscenter/news/20261111-13303.html 预计4Q26 PC DRAM+13%-18%、客户端SSD<5%；库存与需求分化。ongoing为分析判定，hasGlobalPriceHike保留历史涨价阶段标记，不等同全品类继续涨价。';
fs.writeFileSync(mp,JSON.stringify(m,null,2)+'\n');
fs.writeFileSync('scripts/debug/data-update-2026-11-15.json',JSON.stringify({total,stale,normalized,updates},null,2));
console.log(JSON.stringify({total,stale,normalized,officialUpdates:updates.length,bytes:Buffer.byteLength(JSON.stringify(d))}));
