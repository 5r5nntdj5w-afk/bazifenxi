/**
 * 快速验证：宏902（AND顶层）底层字段评估
 * 八字 186804142200 = 戊辰 丙辰 庚午 丁亥，大运丙寅，流年戊申（用户当前测试场景）
 * 断语级默认取值=地支
 */
const fs = require('fs');
const vm = require('vm');

let code = fs.readFileSync('api/matchDuanyu.js', 'utf8');
const idx = code.indexOf('module.exports =');
if (idx < 0) throw new Error('module.exports not found');
code = code.slice(0, idx);
code += `
module.exports = {
  evaluateConditionNode,
  evaluateLeafCondition,
  evaluateBatchPositions,
  evaluateBatchPositionsFlip,
  checkSinglePosition,
  extractInheritArrangements,
  mergeArrangementWithIncrement,
  applyMappingToArrangement,
  applyMappingValue,
  resolveDefaultMapping,
  getMacroDefaultQuZhi,
  _parseBiEncoded,
  _extractBiConfigsFromMacro,
  _mapBiConfigValues,
  WU_XING,
  SHEN_TO_GROUP,
  getExactShen,
  getDiShen,
  PB_COLUMN_PATH_MAP,
  PB_FLIP_MAP,
  PB_FLIP_MAP_COL,
  flipPositions,
  findMacroById
};
`;

const sandbox = {
  require: (m) => {
    if (m === 'https') return require('https');
    if (m === 'http') return require('http');
    return require(m);
  },
  module: { exports: {} },
  exports: {},
  console: console,
  process: process,
  Buffer: Buffer,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  JSON: JSON,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  Math: Math,
  Date: Date,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  Promise: Promise,
  Set: Set,
  Map: Map,
  RegExp: RegExp
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const F = sandbox.module.exports;

// ========== 用户当前排盘数据 ==========
const data = {
  nian: { t: '戊', d: '辰' },
  yue:  { t: '丙', d: '辰' },
  ri:   { t: '庚', d: '午' },
  shi:  { t: '丁', d: '亥' },
  dayun: { t: '丙', d: '寅' },
  liunian: { t: '戊', d: '申' },
  liuyue: null,
  macros: []
};

// ========== 宏 902 最新条件（用户改为 AND 顶层后从浏览器读取） ==========
const macro902 = {
  id: '902',
  cloudId: 902,
  name: '【比劫克财】原局食伤-官杀-印三神+大运流年五神俱全（五神俱全基准宏5）',
  conditions: {
    logic: 'and',
    children: [
      {
        logic: 'and',
        children: [
          {
            op: 'eq',
            val: '定位批量|type=十神组|ganZhi=通用|scope=原局+大运+流年|flip=1|年柱=不限|月柱=不限|日柱=不限|时柱=不限|大运柱=财星|流年柱=比劫',
            field: '定位批量-十神',
            logic: 'and'
          },
          {
            op: 'eq',
            val: '批量包含|type=十神组|ganZhi=通用|scope=原局|包含=食伤,官杀,印星|排除=比劫,财星',
            field: '批量包含-十神组',
            logic: 'and'
          }
        ]
      }
    ],
    defaultQuZhi: '',
    defaultMapping: {}
  }
};
data.macros.push(macro902);

// 断语级默认取值=地支 的上下文
const ctxDiZhi = {
  ruleDefaultMapping: null,
  macroDefaultMapping: null,
  ruleDefaultQuZhi: '地支',
  macroDefaultQuZhi: ''
};
const ctxNone = {
  ruleDefaultMapping: null,
  macroDefaultMapping: null,
  ruleDefaultQuZhi: '',
  macroDefaultQuZhi: ''
};

// 输出各柱十神组（地支维度）供核对
function showPillars() {
  const rg = data.ri.t;
  const names = { nian: '年', yue: '月', ri: '日', shi: '时', dayun: '大运', liunian: '流年' };
  for (const k in names) {
    const p = data[k];
    if (!p) { console.log(names[k] + '柱: 无'); continue; }
    const dShen = F.getDiShen(p.d, rg);
    const tShen = F.getExactShen(p.t, rg);
    console.log(names[k] + '柱 ' + p.t + '/' + p.d + ' 干:' + tShen + '(' + (F.SHEN_TO_GROUP[tShen] || '?') + ') 支:' + dShen + '(' + (F.SHEN_TO_GROUP[dShen] || '?') + ')');
  }
}

console.log('===== 各柱十神（日主=' + data.ri.t + '）=====');
showPillars();

// 直接评估宏内两个叶子字段
console.log('\n===== 宏902 内部叶子字段直接评估（断语级 defaultQuZhi=地支）=====');
const leaf1 = macro902.conditions.children[0].children[0];
const leaf2 = macro902.conditions.children[0].children[1];
let r1 = F.evaluateLeafCondition(data, leaf1, ctxDiZhi);
console.log('定位批量-十神: ' + (r1 ? '✅ 匹配' : '❌ 不匹配'));
let r2 = F.evaluateLeafCondition(data, leaf2, ctxDiZhi);
console.log('批量包含-十神组: ' + (r2 ? '✅ 匹配' : '❌ 不匹配'));

console.log('\n===== 宏902 内部叶子字段直接评估（无断语级取值）=====');
let r1b = F.evaluateLeafCondition(data, leaf1, ctxNone);
console.log('定位批量-十神: ' + (r1b ? '✅ 匹配' : '❌ 不匹配') + '（pbQuZhi 空 → 通用模板模式 fail-closed）');
let r2b = F.evaluateLeafCondition(data, leaf2, ctxNone);
console.log('批量包含-十神组: ' + (r2b ? '✅ 匹配' : '❌ 不匹配') + '（默认回退天干）');

// 宏引用完整评估（macroRef）
console.log('\n===== 宏引用完整评估（断语级 defaultQuZhi=地支）=====');
const macroRefCond = { macroRef: '902' };
let rM = F.evaluateConditionNode(data, macroRefCond, ctxDiZhi);
console.log('宏引用(902): ' + (rM ? '✅ 匹配' : '❌ 不匹配'));

console.log('\n===== 宏引用完整评估（无断语级取值）=====');
let rMb = F.evaluateConditionNode(data, macroRefCond, ctxNone);
console.log('宏引用(902): ' + (rMb ? '✅ 匹配' : '❌ 不匹配'));

// 验证"层级上限约束"假设：移除大运/流年后，批量包含 scope=原局 是否匹配
console.log('\n===== 验证层级上限约束假设（无大运/流年数据）=====');
const dataNoLuck = JSON.parse(JSON.stringify(data));
dataNoLuck.dayun = null;
dataNoLuck.liunian = null;
let rBiNoLuck = F.evaluateLeafCondition(dataNoLuck, leaf2, ctxDiZhi);
console.log('批量包含-十神组(无大运/流年): ' + (rBiNoLuck ? '✅ 匹配' : '❌ 不匹配'));
let rBiNoLuck2 = F.evaluateLeafCondition(dataNoLuck, leaf1, ctxDiZhi);
console.log('定位批量-十神(无大运/流年): ' + (rBiNoLuck2 ? '✅ 匹配' : '❌ 不匹配'));

// ===== 映射引用版断语（e252）场景：AND(定位批量映射, 批量包含映射) =====
console.log('\n===== 映射引用版断语 e252 完整评估（断语级 defaultQuZhi=地支）=====');
// 映射引用编码：mappingBase=902，映射规则保持原值（mapping=空），增量位置从基准宏排列兜底
const e252cond = {
  logic: 'and',
  children: [
    {
      op: 'eq',
      val: '定位批量|mappingBase=902|mapping=|mappingType=|mappingOffset=|type=十神组|ganZhi=通用|flip=1',
      field: '定位批量-十神',
      logic: 'and'
    },
    {
      op: 'eq',
      val: '批量包含|mappingBase=902|mapping=|mappingType=|mappingOffset=|type=十神组|ganZhi=通用|scope=原局',
      field: '批量包含-十神组',
      logic: 'and'
    }
  ],
  defaultQuZhi: '地支',
  defaultMapping: {}
};
let rE252 = F.evaluateConditionNode(data, e252cond, { ruleDefaultQuZhi: '地支' });
console.log('映射引用版e252: ' + (rE252 ? '✅ 匹配' : '❌ 不匹配'));

// ===== 条件宏引用版断语（e251）场景 =====
console.log('\n===== 条件宏引用版断语 e251 完整评估（断语级 defaultQuZhi=地支）=====');
const e251cond = {
  logic: 'and',
  children: [
    { macroRef: '902' }
  ],
  defaultQuZhi: '地支',
  defaultMapping: {}
};
let rE251 = F.evaluateConditionNode(data, e251cond, { ruleDefaultQuZhi: '地支' });
console.log('条件宏引用版e251: ' + (rE251 ? '✅ 匹配' : '❌ 不匹配'));

// ===== 流月层级支持：批量包含 scope=原局+大运+流年+流月 =====
console.log('\n===== 批量包含 scope=原局+大运+流年+流月（含流月柱统计）=====');
const dataLiuYue = JSON.parse(JSON.stringify(data));
dataLiuYue.liuyue = { t: '壬', d: '子' }; // 流月 壬子：干壬=食神/食伤组（天干维度新增唯一值）
const leafLiuYue = {
  op: 'eq',
  val: '批量包含|type=十神组|ganZhi=天干|scope=原局+大运+流年+流月|包含=食伤',
  field: '批量包含-十神组',
  logic: 'and'
};
// 天干收集：戊(印星)丙(官杀)庚(比劫)丁(官杀)+丙(官杀)戊(印星) → 无食伤；流月干壬(食伤) → 添加后满足
let rLiuYue = F.evaluateLeafCondition(dataLiuYue, leafLiuYue, ctxNone);
console.log('批量包含(含流月, scope=原局+大运+流年+流月): ' + (rLiuYue ? '✅ 匹配' : '❌ 不匹配') + '（期望✅：流月干壬=食伤 被统计）');
// 对照：无流月数据时同样 scope 应无食伤 → 不匹配（证明流月柱确实参与统计）
let rLiuYue2 = F.evaluateLeafCondition(data, leafLiuYue, ctxNone);
console.log('批量包含(无流月数据, scope=原局+大运+流年+流月): ' + (rLiuYue2 ? '✅ 匹配' : '❌ 不匹配') + '（期望❌：无流月则无食伤）');

console.log('\n===== 总结 =====');
console.log('若 有运/流年时批量包含不匹配、无运/流年时匹配 → 根因=批量包含 scope=原局 的"层级上限约束"拦截');
console.log('（scope=原局 被实现为"更高层级必须不存在"，而用户排盘有大运丙寅+流年戊申 → 恒不匹配）');

// ===== 映射引用层级以引用字段自身为准（2026-08-18 定稿）=====
console.log('\n===== 映射引用层级以引用字段自身为准 =====');
// 基准宏：批量包含 scope=原局、包含=[财星]（原局地支无财星，原局+大运地支含财星=大运支寅）
const baseMacroScopeYuanJu = {
  id: '999',
  cloudId: 999,
  name: '映射层级测试-基准宏（scope=原局，包含=财星）',
  conditions: {
    logic: 'and',
    children: [
      {
        op: 'eq',
        val: '批量包含|type=十神组|ganZhi=通用|scope=原局|包含=财星',
        field: '批量包含-十神组',
        logic: 'and'
      }
    ],
    defaultQuZhi: '',
    defaultMapping: {}
  }
};
const dataSc = JSON.parse(JSON.stringify(data));
dataSc.macros = (data.macros || []).concat([baseMacroScopeYuanJu]);
// 字段自身 scope=原局（ganZhi=地支，ctxNone）→ 原局地支无财星 → 不匹配（证明基准宏 scope=原局 未生效于字段层级）
const leafMapScYuanJu = {
  op: 'eq',
  val: '批量包含|mappingBase=999|mapping=|mappingType=|mappingOffset=|type=十神组|ganZhi=地支|scope=原局',
  field: '批量包含-十神组',
  logic: 'and'
};
let rMapScYuanJu = F.evaluateLeafCondition(dataSc, leafMapScYuanJu, ctxNone);
console.log('映射引用(基准scope=原局, 字段scope=原局, 地支): ' + (rMapScYuanJu ? '✅ 匹配' : '❌ 不匹配') + '（期望❌：原局地支无财星）');
// 字段自身 scope=原局+大运（ganZhi=地支，ctxNone）→ 原局+大运地支含财星（大运支寅）→ 匹配
// 证明：基准宏 scope=原局 被忽略，层级以字段自身（原局+大运）为准统计
const leafMapScDayun = {
  op: 'eq',
  val: '批量包含|mappingBase=999|mapping=|mappingType=|mappingOffset=|type=十神组|ganZhi=地支|scope=原局+大运',
  field: '批量包含-十神组',
  logic: 'and'
};
let rMapScDayun = F.evaluateLeafCondition(dataSc, leafMapScDayun, ctxNone);
console.log('映射引用(基准scope=原局, 字段scope=原局+大运, 地支): ' + (rMapScDayun ? '✅ 匹配' : '❌ 不匹配') + '（期望✅：原局+大运地支含财星=大运支寅）');
