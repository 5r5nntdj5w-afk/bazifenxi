/**
 * api/matchDuanyu.js — Vercel Serverless 断语匹配引擎
 *
 * 从 SCF（tencent-scf-bazi-embedded.js）提取的完整匹配逻辑，
 * 部署在 Vercel 上，保护断语条件规则不在前端暴露。
 *
 * 调用方式：
 *   POST /api/matchDuanyu
 *   Body: { bazi, dayun[], liunian[], gender, birthYear }
 *
 * 环境变量：
 *   SUPABASE_URL      — Supabase 项目地址
 *   SUPABASE_KEY      — Supabase anon key（或 service_role key）
 *   ADMIN_EMAIL       — 管理员邮箱（逗号分隔）
 */

const https = require('https');
const http = require('http');

// ===================== 常量定义 =====================

var WU_XING = {
  '甲':'木','乙':'木','丙':'火','丁':'火','戊':'土','己':'土',
  '庚':'金','辛':'金','壬':'水','癸':'水',
  '子':'水','丑':'土','寅':'木','卯':'木','辰':'土','巳':'火',
  '午':'火','未':'土','申':'金','酉':'金','戌':'土','亥':'水'
};

var GAN_YINYANG = {
  '甲':'阳','乙':'阴','丙':'阳','丁':'阴','戊':'阳',
  '己':'阴','庚':'阳','辛':'阴','壬':'阳','癸':'阴'
};

var DI_ZHU_MAIN = {
  '子':'癸','丑':'己','寅':'甲','卯':'乙','辰':'戊',
  '巳':'丙','午':'丁','未':'己','申':'庚','酉':'辛','戌':'戊','亥':'壬'
};

var SHEN_TO_GROUP = {
  '比肩':'比劫','劫财':'比劫',
  '食神':'食伤','伤官':'食伤',
  '正财':'财星','偏财':'财星',
  '正官':'官杀','七杀':'官杀',
  '正印':'印星','偏印':'印星'
};

var WU_LIST = ['木','火','土','金','水'];
var FULL_SHEN = ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'];

// 原局位置翻转映射（年↔时、月↔日），大运/流年/流月不翻转
var PB_FLIP_MAP = {
  '年干':'时干','时干':'年干',
  '月干':'日干','日干':'月干',
  '年支':'时支','时支':'年支',
  '月支':'日支','日支':'月支'
};
// 通用模式柱名翻转（年柱↔时柱、月柱↔日柱）
var PB_FLIP_MAP_COL = {
  '年柱':'时柱','时柱':'年柱',
  '月柱':'日柱','日柱':'月柱'
};

// 映射闭环（相生顺序）
var PB_SHEN_GROUP_CYCLE = ['比劫','食伤','财星','官杀','印星'];
var PB_WU_CYCLE = ['金','水','木','火','土'];

// ===================== 核心函数 =====================

/** 精确十神（天干） */
function getExactShen(gan, riGan) {
  if (!gan || !riGan) return '-';
  var gx = WU_XING[gan], rx = WU_XING[riGan];
  var gy = GAN_YINYANG[gan], ry = GAN_YINYANG[riGan];

  if (gx === rx) return gy === ry ? '比肩' : '劫财';

  function sheng(x, y) {
    return (x==='木'&&y==='火')||(x==='火'&&y==='土')||(x==='土'&&y==='金')||(x==='金'&&y==='水')||(x==='水'&&y==='木');
  }
  if (sheng(gx, rx)) return gy !== ry ? '正印' : '偏印';
  if (sheng(rx, gx)) return gy === ry ? '食神' : '伤官';

  function ke(x, y) {
    return (x==='木'&&y==='土')||(x==='土'&&y==='水')||(x==='水'&&y==='火')||(x==='火'&&y==='金')||(x==='金'&&y==='木');
  }
  if (ke(gx, rx)) return gy !== ry ? '正官' : '七杀';
  if (ke(rx, gx)) return gy !== ry ? '正财' : '偏财';

  return '-';
}

/** 地支十神 */
function getDiShen(d, rg) {
  return d ? getExactShen(DI_ZHU_MAIN[d], rg) : '-';
}

/** 获取某个字段的值 */
function getFieldValue(data, fieldName) {
  var map = {
    '年干': 'nian.t', '年支': 'nian.d',
    '月干': 'yue.t', '月支': 'yue.d',
    '日干': 'ri.t',   '日支': 'ri.d',
    '时干': 'shi.t',  '时支': 'shi.d',
    '大运干': 'dayun.t', '大运支': 'dayun.d',
    '流年干': 'liunian.t', '流年支': 'liunian.d',
    '流月干': 'liuyue.t', '流月支': 'liuyue.d'
  };
  var path = map[fieldName];
  if (!path) return '';
  var parts = path.split('.');
  var k = parts[0], p = parts[1];
  return data[k] && data[k][p] !== undefined ? data[k][p] : '';
}

/** 五行数量统计 */
function countWuXing(data, wuXingName, scope) {
  var cnt = 0;
  var pillars = [
    {t: data.nian && data.nian.t, d: data.nian && data.nian.d},
    {t: data.yue && data.yue.t, d: data.yue && data.yue.d},
    {t: data.ri && data.ri.t, d: data.ri && data.ri.d},
    {t: data.shi && data.shi.t, d: data.shi && data.shi.d}
  ];

  if (scope === 'tiangan') {
    for (var i = 0; i < pillars.length; i++) { if (pillars[i].t && WU_XING[pillars[i].t] === wuXingName) cnt++; }
    if (data.dayun && data.dayun.t && WU_XING[data.dayun.t] === wuXingName) cnt++;
    if (data.liunian && data.liunian.t && WU_XING[data.liunian.t] === wuXingName) cnt++;
  } else if (scope === 'dizhi') {
    for (var i = 0; i < pillars.length; i++) { if (pillars[i].d && WU_XING[pillars[i].d] === wuXingName) cnt++; }
    if (data.dayun && data.dayun.d && WU_XING[data.dayun.d] === wuXingName) cnt++;
    if (data.liunian && data.liunian.d && WU_XING[data.liunian.d] === wuXingName) cnt++;
  } else {
    for (var i = 0; i < pillars.length; i++) {
      if (pillars[i].t && WU_XING[pillars[i].t] === wuXingName) cnt++;
      if (pillars[i].d && WU_XING[pillars[i].d] === wuXingName) cnt++;
    }
    if (data.dayun && data.dayun.t && WU_XING[data.dayun.t] === wuXingName) cnt++;
    if (data.dayun && data.dayun.d && WU_XING[data.dayun.d] === wuXingName) cnt++;
    if (data.liunian && data.liunian.t && WU_XING[data.liunian.t] === wuXingName) cnt++;
    if (data.liunian && data.liunian.d && WU_XING[data.liunian.d] === wuXingName) cnt++;
  }
  return cnt;
}

/** 十神数量统计 */
function countShen(data, shenName, scope) {
  if (!data.ri || !data.ri.t) return 0;
  var rg = data.ri.t;
  var cnt = 0;
  var pillars = [
    {t: data.nian && data.nian.t, d: data.nian && data.nian.d},
    {t: data.yue && data.yue.t, d: data.yue && data.yue.d},
    {t: data.ri && data.ri.t, d: data.ri && data.ri.d},
    {t: data.shi && data.shi.t, d: data.shi && data.shi.d}
  ];

  var check = function(ganOrZhi) {
    if (scope === 'tiangan' && ganOrZhi === 'zhi') return false;
    if (scope === 'dizhi' && ganOrZhi === 'gan') return false;
    return true;
  };

  for (var i = 0; i < pillars.length; i++) {
    var p = pillars[i];
    if (p.t && check('gan') && getExactShen(p.t, rg) === shenName) cnt++;
    if (p.d && check('zhi') && getDiShen(p.d, rg) === shenName) cnt++;
  }

  if (data.dayun && data.dayun.t && check('gan') && getExactShen(data.dayun.t, rg) === shenName) cnt++;
  if (data.dayun && data.dayun.d && check('zhi') && getDiShen(data.dayun.d, rg) === shenName) cnt++;
  if (data.liunian && data.liunian.t && check('gan') && getExactShen(data.liunian.t, rg) === shenName) cnt++;
  if (data.liunian && data.liunian.d && check('zhi') && getDiShen(data.liunian.d, rg) === shenName) cnt++;

  return cnt;
}

/** 计算十神组数量 */
function countShenGroup(data, groupName, scope) {
  var cnt = 0;
  for (var i = 0; i < FULL_SHEN.length; i++) {
    var shen = FULL_SHEN[i];
    if (SHEN_TO_GROUP[shen] === groupName) {
      cnt += countShen(data, shen, scope);
    }
  }
  return cnt;
}

// ===================== 条件评估 =====================

/**
 * 递归评估条件树
 */
function evaluateConditionNode(data, condNode, context) {
  context = context || {};
  
  // macroRef 节点：查找宏定义并递归评估
  if (condNode && condNode.macroRef) {
    var macroId = String(condNode.macroRef);
    var macros = data && data.macros;
    if (macros && macros.length > 0) {
      // 先精确匹配 cloudId
      for (var mi = 0; mi < macros.length; mi++) {
        var m = macros[mi];
        if (m && m.conditions && (String(m.id) === macroId || String(m.cloudId) === macroId)) {
          // 传递宏的默认取值维度到上下文（优先从 conditions.defaultQuZhi 读取，兼容旧版顶层 defaultQuZhi）
          var newContext = {};
          var mDefQz = (m.conditions && m.conditions.defaultQuZhi) || m.defaultQuZhi || '';
          if (mDefQz) newContext.macroDefaultQuZhi = mDefQz;
          // 传递宏的默认映射规则到上下文
          var mDefMap = (m.conditions && m.conditions.defaultMapping) || null;
          if (mDefMap) newContext.macroDefaultMapping = mDefMap;
          // 保留断语规则的默认取值维度（最高优先级，递归时不丢失）
          if (context.ruleDefaultQuZhi) newContext.ruleDefaultQuZhi = context.ruleDefaultQuZhi;
          // 保留断语规则的默认映射规则（最高优先级，递归时不丢失）
          if (context.ruleDefaultMapping) newContext.ruleDefaultMapping = context.ruleDefaultMapping;
          return evaluateConditionNode(data, m.conditions, newContext);
        }
      }
      // 未匹配到：尝试通过 idMapping 将本地 ID 转为 cloudId
      if (data.idMapping && data.idMapping.macros) {
        var resolvedCloudId = data.idMapping.macros[macroId];
        if (resolvedCloudId) {
          for (var mi = 0; mi < macros.length; mi++) {
            var m = macros[mi];
            if (m && m.conditions && String(m.id) === String(resolvedCloudId)) {
              var newContext2 = {};
              var mDefQz2 = (m.conditions && m.conditions.defaultQuZhi) || m.defaultQuZhi || '';
              if (mDefQz2) newContext2.macroDefaultQuZhi = mDefQz2;
              var mDefMap2 = (m.conditions && m.conditions.defaultMapping) || null;
              if (mDefMap2) newContext2.macroDefaultMapping = mDefMap2;
              // 保留断语规则的默认取值维度（最高优先级，递归时不丢失）
              if (context.ruleDefaultQuZhi) newContext2.ruleDefaultQuZhi = context.ruleDefaultQuZhi;
              // 保留断语规则的默认映射规则（最高优先级，递归时不丢失）
              if (context.ruleDefaultMapping) newContext2.ruleDefaultMapping = context.ruleDefaultMapping;
              return evaluateConditionNode(data, m.conditions, newContext2);
            }
          }
        }
      }
    }
    return false;
  }

  // ruleRef 节点：查找被引用的断语并递归评估
  if (condNode && condNode.ruleRef) {
    var ruleRefId = String(condNode.ruleRef);
    var rulesList = data && data.rules;
    if (rulesList && rulesList.length > 0) {
      for (var ri = 0; ri < rulesList.length; ri++) {
        var rr = rulesList[ri];
        if (rr && rr.conditions && (String(rr.id) === ruleRefId || String(rr.cloudId) === ruleRefId)) {
          // 被引用断语自身的断语级默认取值维度/默认映射规则优先（断语级最高优先级），未设置时回退外层
          var refCtx = {};
          var refDefQz = (rr.conditions && rr.conditions.defaultQuZhi) || '';
          if (refDefQz) refCtx.ruleDefaultQuZhi = refDefQz;
          else if (context.ruleDefaultQuZhi) refCtx.ruleDefaultQuZhi = context.ruleDefaultQuZhi;
          var refDefMap = (rr.conditions && rr.conditions.defaultMapping) || null;
          if (refDefMap) refCtx.ruleDefaultMapping = refDefMap;
          else if (context.ruleDefaultMapping) refCtx.ruleDefaultMapping = context.ruleDefaultMapping;
          if (context.macroDefaultQuZhi) refCtx.macroDefaultQuZhi = context.macroDefaultQuZhi;
          if (context.macroDefaultMapping) refCtx.macroDefaultMapping = context.macroDefaultMapping;
          // 兼容旧格式：conditions 为线性条件数组时包装为 and 组
          var rrCond = rr.conditions;
          if (Array.isArray(rrCond)) rrCond = { logic: 'and', children: rrCond };
          return evaluateConditionNode(data, rrCond, refCtx);
        }
      }
    }
    return false;
  }

  // 叶子节点：包含 op, val, field
  if (condNode.op && condNode.field !== undefined) {
    return evaluateLeafCondition(data, condNode, context);
  }

  // 分支节点：包含 logic, children
  if (condNode.logic && condNode.children && condNode.children.length > 0) {
    var children = condNode.children;
    
    // not_all 逻辑：全排除 — 所有子条件都不满足时才返回 true
    if (condNode.logic === 'not_all') {
      for (var i = 0; i < children.length; i++) {
        var childResult = evaluateConditionNode(data, children[i], context);
        if (children[i].exclude) childResult = !childResult; // 子条件自身的排除取反
        if (childResult) return false; // 任一条件满足 → 全排除失败
      }
      return true; // 全都不满足 → 全排除成立
    }
    
    if (condNode.logic === 'or') {
      for (var i = 0; i < children.length; i++) {
        var childResult = evaluateConditionNode(data, children[i], context);
        if (children[i].exclude) childResult = !childResult;
        if (childResult) return true;
      }
      return false;
    } else {
      for (var i = 0; i < children.length; i++) {
        var childResult = evaluateConditionNode(data, children[i], context);
        if (children[i].exclude) childResult = !childResult;
        if (!childResult) return false;
      }
      return true;
    }
  }

  return true;
}

/**
 * 定位批量通用模式的位置路径映射（柱名 → [天干路径, 地支路径]）
 */
var PB_COLUMN_PATH_MAP = {
  '年柱': ['nian.t', 'nian.d'],
  '月柱': ['yue.t', 'yue.d'],
  '日柱': ['ri.t', 'ri.d'],
  '时柱': ['shi.t', 'shi.d'],
  '大运柱': ['dayun.t', 'dayun.d'],
  '流年柱': ['liunian.t', 'liunian.d'],
  '流月柱': ['liuyue.t', 'liuyue.d']
};

/**
 * 根据 ID 查找宏并返回其默认取值维度
 * @param {Object} data - 匹配数据（含 macros）
 * @param {String} macroId - 宏的 cloudId/id
 * @returns {String} 默认取值维度（天干/地支），未设置则返回空字符串
 */
function getMacroDefaultQuZhi(data, macroId) {
  if (!macroId) return '';
  var macros = data && data.macros;
  if (!macros || macros.length === 0) return '';
  for (var mi = 0; mi < macros.length; mi++) {
    var m = macros[mi];
    if (m && (String(m.id) === String(macroId) || String(m.cloudId) === String(macroId))) {
      return (m.conditions && m.conditions.defaultQuZhi) || m.defaultQuZhi || '';
    }
  }
  // 尝试通过 idMapping 解析
  if (data.idMapping && data.idMapping.macros) {
    var resolvedCloudId = data.idMapping.macros[macroId];
    if (resolvedCloudId) {
      for (var mi2 = 0; mi2 < macros.length; mi2++) {
        var m2 = macros[mi2];
        if (m2 && (String(m2.id) === String(resolvedCloudId) || String(m2.cloudId) === String(resolvedCloudId))) {
          return (m2.conditions && m2.conditions.defaultQuZhi) || m2.defaultQuZhi || '';
        }
      }
    }
  }
  return '';
}

/**
 * 递归提取被继承条件宏中的所有"定位批量"排列
 * @param {Object} data - 匹配数据（含 macros）
 * @param {String} macroId - 被继承条件宏的 cloudId/id
 * @param {Object} visited - 已访问的宏ID集合（防循环引用）
 * @returns {Array<String>} 排列的编码值数组
 */
function extractInheritArrangements(data, macroId, visited) {
  if (!macroId || visited[macroId]) return [];
  visited[macroId] = true;
  var macros = data && data.macros;
  if (!macros || macros.length === 0) return [];
  var macro = null;
  for (var mi = 0; mi < macros.length; mi++) {
    if (macros[mi] && (String(macros[mi].id) === String(macroId) || String(macros[mi].cloudId) === String(macroId))) {
      macro = macros[mi];
      break;
    }
  }
  // 尝试通过 idMapping 解析
  if (!macro && data.idMapping && data.idMapping.macros) {
    var resolvedCloudId = data.idMapping.macros[macroId];
    if (resolvedCloudId) {
      for (var mi2 = 0; mi2 < macros.length; mi2++) {
        if (macros[mi2] && (String(macros[mi2].id) === String(resolvedCloudId) || String(macros[mi2].cloudId) === String(resolvedCloudId))) {
          macro = macros[mi2];
          break;
        }
      }
    }
  }
  if (!macro || !macro.conditions) return [];
  var arrangements = [];
  function walk(node) {
    if (!node) return;
    if (node.macroRef) {
      // 递归引用其他宏
      var subArr = extractInheritArrangements(data, node.macroRef, visited);
      for (var si = 0; si < subArr.length; si++) arrangements.push(subArr[si]);
      return;
    }
    if (node.field && node.field.indexOf('定位批量-') === 0 && node.val && node.val.indexOf('定位批量|') === 0) {
      // 检查是否本身也是 inherit 节点
      var subInheritId = '';
      var subParts = node.val.split('|');
      for (var spi = 0; spi < subParts.length; spi++) {
        if (subParts[spi].indexOf('inherit=') === 0) {
          subInheritId = subParts[spi].replace('inherit=', '');
          break;
        }
      }
      if (subInheritId) {
        // 嵌套 inherit：递归展开被引用宏的排列，追加该节点的增量条件
        var subArr2 = extractInheritArrangements(data, subInheritId, visited);
        // 提取该节点的增量位置条件
        var incPositions = {};
        for (var spi2 = 0; spi2 < subParts.length; spi2++) {
          var sp = subParts[spi2];
          if (sp.indexOf('=') > 0 && sp.indexOf('type=') !== 0 && sp.indexOf('ganZhi=') !== 0 && sp.indexOf('scope=') !== 0 && sp.indexOf('取值=') !== 0 && sp.indexOf('inherit=') !== 0) {
            var sop = 'eq';
            var sval = sp;
            if (sp.indexOf('!=') > 0) { sop = 'ne'; sval = sp.replace('!=','='); }
            var skv = sval.split('=');
            if (skv.length === 2 && skv[1]) {
              incPositions[skv[0]] = { op: sop, val: skv[1] };
            }
          }
        }
        // 对每个子排列追加增量条件，生成新排列
        for (var sai = 0; sai < subArr2.length; sai++) {
          var newArr = mergeArrangementWithIncrement(subArr2[sai], incPositions);
          arrangements.push(newArr);
        }
      } else {
        // 检查是否本身是映射引用（嵌套映射：基准宏内的字段又映射引用其他宏）
        var subMappingBaseId = '';
        for (var smi = 0; smi < subParts.length; smi++) {
          if (subParts[smi].indexOf('mappingBase=') === 0) {
            subMappingBaseId = subParts[smi].replace('mappingBase=', '');
            break;
          }
        }
        if (subMappingBaseId) {
          // 嵌套映射：递归展开被引用宏的排列，应用该字段自身的映射规则，再追加该字段的增量条件
          var subMappingType = '', subMappingOffset = '';
          var subCustomMap = null;
          for (var smi2 = 0; smi2 < subParts.length; smi2++) {
            if (subParts[smi2].indexOf('mappingType=') === 0) subMappingType = subParts[smi2].replace('mappingType=','');
            else if (subParts[smi2].indexOf('mappingOffset=') === 0) subMappingOffset = subParts[smi2].replace('mappingOffset=','');
            else if (subParts[smi2].indexOf('customMap=') === 0) {
              try { subCustomMap = JSON.parse(decodeURIComponent(subParts[smi2].replace('customMap=',''))); } catch(e) { subCustomMap = null; }
            }
          }
          var subArr3 = extractInheritArrangements(data, subMappingBaseId, visited);
          // 提取该节点的增量位置条件（排除元信息段）
          var incPos2 = {};
          for (var spi3 = 0; spi3 < subParts.length; spi3++) {
            var sp3 = subParts[spi3];
            if (sp3.indexOf('=') > 0 && sp3.indexOf('type=') !== 0 && sp3.indexOf('ganZhi=') !== 0 && sp3.indexOf('scope=') !== 0 && sp3.indexOf('取值=') !== 0 && sp3.indexOf('inherit=') !== 0 && sp3.indexOf('flip=') !== 0 && sp3.indexOf('mapping=') !== 0 && sp3.indexOf('mappingBase=') !== 0 && sp3.indexOf('mappingType=') !== 0 && sp3.indexOf('mappingOffset=') !== 0 && sp3.indexOf('customMap=') !== 0) {
              var sop2 = 'eq';
              var sval2 = sp3;
              if (sp3.indexOf('!=') > 0) { sop2 = 'ne'; sval2 = sp3.replace('!=','='); }
              var skv2 = sval2.split('=');
              if (skv2.length === 2 && skv2[1]) {
                incPos2[skv2[0]] = { op: sop2, val: skv2[1] };
              }
            }
          }
          for (var sai2 = 0; sai2 < subArr3.length; sai2++) {
            // 先应用该字段自身的映射规则，再追加该字段的增量条件（增量保持字面值）
            var mappedSub = applyMappingToArrangement(subArr3[sai2], subMappingType, subMappingOffset, subCustomMap);
            var newArr2 = mergeArrangementWithIncrement(mappedSub, incPos2);
            arrangements.push(newArr2);
          }
        } else {
          // 普通定位批量排列，直接收集
          arrangements.push(node.val);
        }
      }
      return;
    }
    if (node.logic && node.children) {
      for (var ci = 0; ci < node.children.length; ci++) {
        walk(node.children[ci]);
      }
    }
  }
  walk(macro.conditions);
  return arrangements;
}

/**
 * 将一个排列的编码值与增量位置条件合并，生成新排列编码
 */
function mergeArrangementWithIncrement(baseVal, incPositions) {
  if (!baseVal || baseVal.indexOf('定位批量|') !== 0) return baseVal;
  var parts = baseVal.split('|');
  var result = [];
  var basePositions = {};
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p === '定位批量') continue;
    if (p.indexOf('scope=') === 0) continue; // 跳过 scope（继承后范围可能变化）
    if (p.indexOf('=') > 0 && p.indexOf('type=') !== 0 && p.indexOf('ganZhi=') !== 0 && p.indexOf('取值=') !== 0 && p.indexOf('inherit=') !== 0 && p.indexOf('flip=') !== 0 && p.indexOf('mapping=') !== 0 && p.indexOf('mappingBase=') !== 0 && p.indexOf('mappingType=') !== 0 && p.indexOf('mappingOffset=') !== 0 && p.indexOf('customMap=') !== 0 && p.indexOf('inc包含=') !== 0 && p.indexOf('inc排除=') !== 0) {
      // 位置条件，记录下来（后续会被增量覆盖）
      basePositions[p.split('=')[0].replace('!','')] = p;
    } else {
      result.push(p);
    }
  }
  // 用增量位置覆盖基础位置
  for (var incName in incPositions) {
    var inc = incPositions[incName];
    basePositions[incName] = (inc.op === 'ne' ? incName + '!=' : incName + '=') + inc.val;
  }
  // 重新组装
  var header = ['定位批量'];
  var mid = [];
  var posArr = [];
  for (var j = 0; j < result.length; j++) {
    if (result[j].indexOf('type=') === 0 || result[j].indexOf('ganZhi=') === 0 || result[j].indexOf('取值=') === 0) {
      mid.push(result[j]);
    }
  }
  for (var bpName in basePositions) {
    posArr.push(basePositions[bpName]);
  }
  return header.concat(mid).concat(posArr).join('|');
}

/**
 * 根据映射规则对单个值进行闭环偏移转换或自定义映射
 * @param {String} val - 原值（如 '比劫' 或 '金'）
 * @param {String} mappingType - '十神组' 或 '五行' 或 '十神组自定义' 或 '五行自定义'
 * @param {Number} mappingOffset - 偏移步数（1-4）
 * @param {Object} customMap - 自定义映射关系对象 {原值: 目标值}
 * @returns {String} 映射后的值；不在映射范围则原样返回
 */
function applyMappingValue(val, mappingType, mappingOffset, customMap) {
  if (!val) return val;

  // 自定义映射优先
  if (customMap && typeof customMap === 'object') {
    return customMap[val] || val;
  }

  // 偏移映射
  if (!mappingType || !mappingOffset) return val;
  var cycle = (mappingType.indexOf('五行') >= 0) ? PB_WU_CYCLE : PB_SHEN_GROUP_CYCLE;
  var idx = cycle.indexOf(val);
  if (idx < 0) return val; // 不在闭环中，不映射
  var offset = Number(mappingOffset) || 0;
  var newIdx = ((idx + offset) % cycle.length + cycle.length) % cycle.length;
  return cycle[newIdx];
}

/**
 * 按字段类型解析最终生效的映射规则（层级覆盖）
 * 优先级：ruleDefaultMapping[fieldType] > macroDefaultMapping[fieldType] > fieldMappingId
 * @param {String} fieldType - 字段类型（"十神组" / "五行"）
 * @param {Object} ruleDefaultMapping - 断语级默认映射 { "十神组": "ruleId", "五行": "ruleId" }
 * @param {Object} macroDefaultMapping - 条件宏级默认映射
 * @param {String} fieldMappingId - 字段级映射规则ID
 * @param {Array} mappingRules - 映射规则列表（用于查找规则详情）
 * @returns {Object|null} { mappingType, mappingOffset, customMap, _ruleId } 或 null
 */
function resolveDefaultMapping(fieldType, ruleDefaultMapping, macroDefaultMapping, fieldMappingId, mappingRules) {
  if (!fieldType) return null;
  var ruleId = '';
  var source = ''; // 'rule'=断语级 defaultMapping / 'macro'=条件宏级 defaultMapping / 'field'=字段自身映射
  if (ruleDefaultMapping && ruleDefaultMapping[fieldType]) { ruleId = ruleDefaultMapping[fieldType]; source = 'rule'; }
  if (!ruleId && macroDefaultMapping && macroDefaultMapping[fieldType]) { ruleId = macroDefaultMapping[fieldType]; source = 'macro'; }
  if (!ruleId && fieldMappingId) { ruleId = fieldMappingId; source = 'field'; }
  if (!ruleId) return null;
  // 查找规则详情
  var rule = null;
  if (mappingRules && mappingRules.length) {
    for (var i = 0; i < mappingRules.length; i++) {
      if (String(mappingRules[i].id) === String(ruleId)) { rule = mappingRules[i]; break; }
    }
  }
  if (!rule) return null;
  return {
    mappingType: rule.type || '',
    mappingOffset: rule.offset || '',
    customMap: rule.customMap || null,
    _ruleId: ruleId,
    _source: source
  };
}

// ---- 批量包含映射辅助函数 ----
// 按 id / cloudId 查找宏，查找失败时通过 idMapping 将本地ID解析为 cloudId 后二次查找
// （映射引用/继承引用保存的可能是本地ID，云端需要 idMapping 才能定位基准宏）
function findMacroById(data, macroId) {
  if (!macroId) return null;
  var macros = (data && data.macros) || [];
  for (var mi = 0; mi < macros.length; mi++) {
    if (macros[mi] && (String(macros[mi].id) === String(macroId) || String(macros[mi].cloudId) === String(macroId))) {
      return macros[mi];
    }
  }
  if (data && data.idMapping && data.idMapping.macros) {
    var resolvedCloudId = data.idMapping.macros[macroId];
    if (resolvedCloudId) {
      for (var mi2 = 0; mi2 < macros.length; mi2++) {
        if (macros[mi2] && (String(macros[mi2].id) === String(resolvedCloudId) || String(macros[mi2].cloudId) === String(resolvedCloudId))) {
          return macros[mi2];
        }
      }
    }
  }
  return null;
}

// 从条件宏中提取批量包含配置（支持嵌套映射引用递归展开）
function _extractBiConfigsFromMacro(macro, filterType, macros, data, visited) {
  var configs = [];
  if (!macro || !macro.conditions) return configs;
  // 防循环引用：嵌套映射引用（A→B→A）时用 visited 记录已展开的宏
  var key = macro.cloudId != null ? macro.cloudId : macro.id;
  visited = visited || {};
  if (key != null && visited[String(key)]) return configs;
  if (key != null) visited[String(key)] = true;
  function walk(node) {
    if (!node) return;
    if (node.macroRef) {
      var subMacro = findMacroById(data || { macros: macros || [] }, node.macroRef);
      if (subMacro && subMacro.conditions) walk(subMacro.conditions);
      return;
    }
    if (node.field && node.field.indexOf('批量包含-') === 0 && node.val && node.val.indexOf('批量包含|') === 0) {
      var parsed = _parseBiEncoded(node.val);
      if (!parsed) return;
      // 【修复】字段本身是映射引用（mappingBase=基准宏）→ 递归展开其基准宏的批量包含配置，
      // 并对每个子配置应用本字段的映射规则（解决嵌套映射引用时继承值为空的问题）
      if (parsed.mappingBase) {
        var subMacro2 = findMacroById(data || { macros: macros || [] }, parsed.mappingBase);
        if (subMacro2) {
          var subConfigs = _extractBiConfigsFromMacro(subMacro2, filterType || parsed.type, macros, data, visited);
          var subRule = { type: parsed.mappingType || '', offset: parsed.mappingOffset || '', customMap: parsed.customMap || null };
          for (var si = 0; si < subConfigs.length; si++) {
            var sc = subConfigs[si];
            if ((parsed.ganZhi === '通用' || sc.ganZhi === '通用' || sc.ganZhi === parsed.ganZhi) && sc.scope === parsed.scope) {
              configs.push(_mapBiConfigValues(sc, subRule));
            }
          }
        }
        return;
      }
      if (!filterType || parsed.type === filterType) {
        configs.push(parsed);
      }
      return;
    }
    if (node.logic && node.children) {
      for (var ci = 0; ci < node.children.length; ci++) walk(node.children[ci]);
    }
  }
  walk(macro.conditions);
  if (key != null) delete visited[String(key)];
  return configs;
}

// 解析批量包含编码为对象
function _parseBiEncoded(val) {
  if (!val || val.indexOf('批量包含|') !== 0) return null;
  var parts = val.split('|');
  var result = { type: '', ganZhi: '通用', scope: '原局', include: [], exclude: [], mappingBase: '', mappingRule: '', mappingType: '', mappingOffset: '', customMap: null };
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p === '批量包含') continue;
    if (p.indexOf('type=') === 0) result.type = p.replace('type=','');
    else if (p.indexOf('ganZhi=') === 0) result.ganZhi = p.replace('ganZhi=','');
    else if (p.indexOf('scope=') === 0) result.scope = p.replace('scope=','');
    else if (p.indexOf('包含=') === 0) { var s = p.replace('包含=',''); if (s) result.include = s.split(','); }
    else if (p.indexOf('排除=') === 0) { var s = p.replace('排除=',''); if (s) result.exclude = s.split(','); }
    else if (p.indexOf('mappingBase=') === 0) result.mappingBase = p.replace('mappingBase=','');
    else if (p.indexOf('mapping=') === 0) result.mappingRule = p.replace('mapping=','');
    else if (p.indexOf('mappingType=') === 0) result.mappingType = p.replace('mappingType=','');
    else if (p.indexOf('mappingOffset=') === 0) result.mappingOffset = p.replace('mappingOffset=','');
    else if (p.indexOf('customMap=') === 0) { try { result.customMap = JSON.parse(decodeURIComponent(p.replace('customMap=',''))); } catch(e) {} }
  }
  return result;
}

// 对批量包含的包含/排除值应用映射
function _mapBiConfigValues(config, rule) {
  if (!config || !rule) return config;
  var mappingType = rule.type || '';
  var customMap = rule.customMap || null;
  var mappedInclude = [];
  var mappedExclude = [];
  for (var i = 0; i < config.include.length; i++) {
    mappedInclude.push(applyMappingValue(config.include[i], mappingType, rule.offset, customMap));
  }
  for (var j = 0; j < config.exclude.length; j++) {
    mappedExclude.push(applyMappingValue(config.exclude[j], mappingType, rule.offset, customMap));
  }
  return { type: config.type, ganZhi: config.ganZhi, scope: config.scope, include: mappedInclude, exclude: mappedExclude };
}

/**
 * 对一个定位批量排列编码值进行映射转换（仅转换位置条件的值，元信息保留）
 * @param {String} val - 排列编码（以 '定位批量|' 开头）
 * @param {String} mappingType - '十神组' 或 '五行' 或自定义类型
 * @param {Number} mappingOffset - 偏移步数
 * @param {Object} customMap - 自定义映射关系对象
 * @returns {String} 映射后的排列编码
 */
function applyMappingToArrangement(val, mappingType, mappingOffset, customMap) {
  if (!val || val.indexOf('定位批量|') !== 0) return val;
  var parts = val.split('|');
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    // 元信息段直接保留
    if (p === '定位批量' ||
        p.indexOf('type=') === 0 || p.indexOf('ganZhi=') === 0 ||
        p.indexOf('scope=') === 0 || p.indexOf('取值=') === 0 ||
        p.indexOf('inherit=') === 0 || p.indexOf('flip=') === 0 ||
        p.indexOf('mapping=') === 0 || p.indexOf('mappingBase=') === 0 ||
        p.indexOf('mappingType=') === 0 || p.indexOf('mappingOffset=') === 0 ||
        p.indexOf('customMap=') === 0) {
      result.push(p);
    } else if (p.indexOf('=') > 0) {
      // 位置条件段：解析 op / posName / posVal，对 posVal 做映射
      var op = '';
      var posName = '';
      var posVal = '';
      if (p.indexOf('!=') > 0) {
        op = '!=';
        var tmp = p.replace('!=', '=').split('=');
        posName = tmp[0]; posVal = tmp[1];
      } else {
        var kv = p.split('=');
        posName = kv[0]; posVal = kv[1];
      }
      var mappedVal = applyMappingValue(posVal, mappingType, mappingOffset, customMap);
      result.push(posName + op + '=' + mappedVal);
    } else {
      result.push(p);
    }
  }
  return result.join('|');
}

/**
 * 生成原局位置翻转后的 positions 副本（年↔时、月↔日），大运/流年/流月位置保持不变
 * @param {Object} positions - 原位置条件 {年干: {op,val}, ...}
 * @param {String} pbGanZhi - '天干'/'地支'/'通用'，决定用柱名还是干支名翻转表
 * @returns {Object} 翻转后的 positions
 */
function flipPositions(positions, pbGanZhi) {
  var flipMap = (pbGanZhi === '通用') ? PB_FLIP_MAP_COL : PB_FLIP_MAP;
  var flipped = {};
  for (var pos in positions) {
    if (!Object.prototype.hasOwnProperty.call(positions, pos)) continue;
    var flippedPos = flipMap[pos];
    if (flippedPos) {
      // 原局位置：翻转到对应位置
      flipped[flippedPos] = positions[pos];
    } else {
      // 非原局位置（大运/流年/流月）不翻转，保留原样
      flipped[pos] = positions[pos];
    }
  }
  return flipped;
}

/**
 * 判断一组定位批量位置条件是否满足（核心判断，不含翻转）
 * @param {Object} data - 匹配数据
 * @param {Object} positions - {年干: {op:'eq', val:'比劫'}, 年柱: {...}, ...}
 * @param {String} pbType - 五行/十神/十神组
 * @param {String} pbGanZhi - 天干/地支/通用
 * @param {String} pbQuZhi - 取值维度（天干/地支），仅通用模式有效
 * @returns {Boolean}
 */
function evaluateBatchPositions(data, positions, pbType, pbGanZhi, pbQuZhi) {
  var pbPathMap = {
    '年干': 'nian.t','月干': 'yue.t','日干': 'ri.t','时干': 'shi.t',
    '大运干': 'dayun.t','流年干': 'liunian.t','流月干': 'liuyue.t',
    '年支': 'nian.d','月支': 'yue.d','日支': 'ri.d','时支': 'shi.d',
    '大运支': 'dayun.d','流年支': 'liunian.d','流月支': 'liuyue.d'
  };
  var rg = data.ri && data.ri.t ? data.ri.t : '';

  // 先统一收集所有合法位置键（排除元信息意外混入）
  var validKeys = [];
  for (var _k in positions) {
    if (positions.hasOwnProperty && !positions.hasOwnProperty(_k)) continue;
    // 合法位置：天干命名/地支命名/通用柱命名
    if (pbPathMap[_k] || PB_COLUMN_PATH_MAP[_k]) validKeys.push(_k);
  }
  if (validKeys.length === 0) return false; // 没有任何合法位置→不匹配

  // 通用模式：按取值维度只判断对应维度
  if (pbGanZhi === '通用') {
    // 模板模式（未选取值维度）不应直接用于匹配，只通过 inherit 引用
    if (!pbQuZhi) return false;
    var targetSuffix = (pbQuZhi === '地支') ? '.d' : '.t';
    var checkedCount = 0; // 实际参与目标维度判断的位置数（防止跳过所有后 return true）
    for (var vi = 0; vi < validKeys.length; vi++) {
      var posName = validKeys[vi];
      var posCfg = positions[posName];
      var colPaths = PB_COLUMN_PATH_MAP[posName];
      if (!colPaths) {
        // 可能是天干/地支命名的位置（兼容混用），按名称后缀判断
        var directPath = pbPathMap[posName];
        if (!directPath) return false;
        if (directPath.indexOf(targetSuffix) < 0) continue; // 非目标维度→跳过
        checkedCount++;
        if (!checkSinglePosition(data, directPath, posCfg, pbType, posName, rg)) return false;
      } else {
        // 柱名：取目标维度路径
        var targetPath = (pbQuZhi === '地支') ? colPaths[1] : colPaths[0];
        checkedCount++;
        if (!checkSinglePosition(data, targetPath, posCfg, pbType, posName, rg)) return false;
      }
    }
    // 如果没有任何位置落入目标维度，视为不匹配（条件不完整）
    if (checkedCount === 0) return false;
    return true;
  }

  // 天干/地支模式（现有逻辑）
  for (var vi2 = 0; vi2 < validKeys.length; vi2++) {
    var posName2 = validKeys[vi2];
    var posCfg2 = positions[posName2];
    var path2 = pbPathMap[posName2];
    if (!path2) return false;
    if (!checkSinglePosition(data, path2, posCfg2, pbType, posName2, rg)) return false;
  }
  return true;
}

/**
 * 判断定位批量位置条件（支持原局翻转：原 positions 或翻转后 positions 任一满足即 true）
 * 仅翻转原局位置（年↔时、月↔日），大运/流年/流月位置保持不变
 * @param {Boolean} pbFlip - 是否启用原局翻转
 */
function evaluateBatchPositionsFlip(data, positions, pbType, pbGanZhi, pbQuZhi, pbFlip) {
  // 先判断原 positions
  if (evaluateBatchPositions(data, positions, pbType, pbGanZhi, pbQuZhi)) return true;
  if (!pbFlip) return false;
  // 检查是否存在可翻转的原局位置，避免无意义重复判断
  var flipMap = (pbGanZhi === '通用') ? PB_FLIP_MAP_COL : PB_FLIP_MAP;
  var hasFlipPos = false;
  for (var pos in positions) {
    if (Object.prototype.hasOwnProperty.call(positions, pos) && flipMap[pos]) { hasFlipPos = true; break; }
  }
  if (!hasFlipPos) return false;
  // 判断翻转后的 positions
  var flipped = flipPositions(positions, pbGanZhi);
  return evaluateBatchPositions(data, flipped, pbType, pbGanZhi, pbQuZhi);
}

/**
 * 检查单个位置是否满足条件
 */
function checkSinglePosition(data, path, posCfg, pbType, posName, rg) {
  var keys = path.split('.');
  var node = data;
  for (var ki = 0; ki < keys.length; ki++) {
    node = node ? node[keys[ki]] : null;
  }
  if (!node) return false;
  var actualVal = '';
  if (pbType === '五行') {
    actualVal = WU_XING[node] || '';
  } else if (pbType === '十神') {
    if (posName.indexOf('支') >= 0 || path.indexOf('.d') > 0) {
      actualVal = getDiShen(node, rg);
    } else {
      actualVal = getExactShen(node, rg);
    }
  } else if (pbType === '十神组') {
    var shenTmp;
    if (posName.indexOf('支') >= 0 || path.indexOf('.d') > 0) {
      shenTmp = getDiShen(node, rg);
    } else {
      shenTmp = getExactShen(node, rg);
    }
    actualVal = SHEN_TO_GROUP[shenTmp] || '';
  }
  return (posCfg.op === 'eq') ? (actualVal === posCfg.val) : (actualVal !== posCfg.val);
}

/**
 * 评估单个叶子条件
 */
function evaluateLeafCondition(data, cond, context) {
  context = context || {};
  var field = cond.field;
  var op = cond.op;
  var val = cond.val;

  var actual = '';
  var res = false;
  var macroDefaultQuZhi = context.macroDefaultQuZhi || '';
  var ruleDefaultQuZhi = context.ruleDefaultQuZhi || '';
  var macroDefaultMapping = context.macroDefaultMapping || null;
  var ruleDefaultMapping = context.ruleDefaultMapping || null;

  // ---- 自定义字段（通过 template_type 判断） ----
  if (_fieldConfigCache && Array.isArray(_fieldConfigCache)) {
    var config = null;
    for (var ci = 0; ci < _fieldConfigCache.length; ci++) {
      if (_fieldConfigCache[ci].field_value === field) {
        config = _fieldConfigCache[ci];
        break;
      }
    }
    
    if (config && config.template_type) {
      var tt = config.template_type;
      
      // 五行数量对比
      if (tt === 'count_compare_wuxing') {
        var _cnt1 = countWuXing(data, '', 'all');
        var _name1 = '';
        var _fieldMatch = field.match(/-(.+)$/);
        if (_fieldMatch && _fieldMatch[1]) {
          _name1 = _fieldMatch[1];
          _cnt1 = countWuXing(data, _name1, 'all');
        }
        
        var _cnt2;
        var valConfig = null;
        for (var vci = 0; vci < _fieldConfigCache.length; vci++) {
          if (_fieldConfigCache[vci].field_value === val) {
            valConfig = _fieldConfigCache[vci];
            break;
          }
        }
        
        if (valConfig && valConfig.template_type === 'count_compare_wuxing') {
          var _valMatch = val.match(/-(.+)$/);
          var _valName = _valMatch && _valMatch[1] ? _valMatch[1] : val;
          _cnt2 = countWuXing(data, _valName, 'all');
        } else if (WU_LIST.indexOf(val) >= 0) {
          _cnt2 = countWuXing(data, val, 'all');
        } else {
          _cnt2 = countWuXing(data, val, 'all');
        }
        
        if (op === 'eq') res = _cnt1 == _cnt2;
        else if (op === 'ge') res = _cnt1 >= _cnt2;
        else if (op === 'gt') res = _cnt1 > _cnt2;
        else if (op === 'le') res = _cnt1 <= _cnt2;
        else if (op === 'lt') res = _cnt1 < _cnt2;
        actual = field + '=' + _cnt1 + ', ' + val + '=' + _cnt2;
        return res;
      }
      
      // 十神数量对比
      if (tt === 'count_compare_shishen') {
        var _cntA = 0, _cntB = 0;
        var _rg = data.ri && data.ri.t;
        
        if (_rg) {
          var _shenName1 = '';
          var _shenMatch1 = field.match(/-(.+)$/);
          if (_shenMatch1 && _shenMatch1[1]) {
            _shenName1 = _shenMatch1[1];
          }
          
          var _isGroup1 = ['比劫','食伤','财星','官杀','印星'].indexOf(_shenName1) >= 0;
          var _pillarsC = ['nian','yue','ri','shi'];
          
          for (var pci = 0; pci < _pillarsC.length; pci++) {
            var pc = data[_pillarsC[pci]];
            if (pc && pc.t) {
              var sc1 = getExactShen(pc.t, _rg);
              if (_isGroup1 ? (SHEN_TO_GROUP[sc1] === _shenName1) : (sc1 === _shenName1)) _cntA++;
            }
            if (pc && pc.d) {
              var sc2 = getDiShen(pc.d, _rg);
              if (_isGroup1 ? (SHEN_TO_GROUP[sc2] === _shenName1) : (sc2 === _shenName1)) _cntA++;
            }
          }
          
          var _valConfig = null;
          for (var vci2 = 0; vci2 < _fieldConfigCache.length; vci2++) {
            if (_fieldConfigCache[vci2].field_value === val) {
              _valConfig = _fieldConfigCache[vci2];
              break;
            }
          }
          
          var _shenName2 = val;
          if (_valConfig && _valConfig.template_type === 'count_compare_shishen') {
            var _shenMatch2 = val.match(/-(.+)$/);
            if (_shenMatch2 && _shenMatch2[1]) {
              _shenName2 = _shenMatch2[1];
            }
          }
          
          var _isGroup2 = ['比劫','食伤','财星','官杀','印星'].indexOf(_shenName2) >= 0;
          
          for (var pcii = 0; pcii < _pillarsC.length; pcii++) {
            var pcc = data[_pillarsC[pcii]];
            if (pcc && pcc.t) {
              var sc3 = getExactShen(pcc.t, _rg);
              if (_isGroup2 ? (SHEN_TO_GROUP[sc3] === _shenName2) : (sc3 === _shenName2)) _cntB++;
            }
            if (pcc && pcc.d) {
              var sc4 = getDiShen(pcc.d, _rg);
              if (_isGroup2 ? (SHEN_TO_GROUP[sc4] === _shenName2) : (sc4 === _shenName2)) _cntB++;
            }
          }
        }
        
        if (op === 'eq') res = _cntA == _cntB;
        else if (op === 'ge') res = _cntA >= _cntB;
        else if (op === 'gt') res = _cntA > _cntB;
        else if (op === 'le') res = _cntA <= _cntB;
        else if (op === 'lt') res = _cntA < _cntB;
        actual = field + '=' + _cntA + ', ' + val + '=' + _cntB;
        return res;
      }
    }
  }

  // ---- 定位批量判断 ----
  if (field.indexOf('定位批量-') === 0 && val && val.indexOf('定位批量|') === 0) {
    // 解析编码值
    var parts = val.split('|');
    var pbType = '十神', pbGanZhi = '天干', pbScope = '原局', pbQuZhi = '';
    var pbInheritId = '';
    var pbFlip = false; // 原局翻转（由编码 flip= 决定）
    var pbMappingId = '', pbMappingBaseId = '', pbMappingType = '', pbMappingOffset = '';
    var pbCustomMap = null; // 自定义映射关系
    var pbPositions = {}; // {年干: {op:'eq', val:'食伤'}, ...}
    for (var pi = 0; pi < parts.length; pi++) {
      var p = parts[pi];
      if (p.indexOf('type=') === 0) pbType = p.replace('type=','');
      else if (p.indexOf('ganZhi=') === 0) pbGanZhi = p.replace('ganZhi=','');
      else if (p.indexOf('scope=') === 0) pbScope = p.replace('scope=','');
      else if (p.indexOf('取值=') === 0) pbQuZhi = p.replace('取值=','');
      else if (p.indexOf('inherit=') === 0) pbInheritId = p.replace('inherit=','');
      else if (p.indexOf('flip=') === 0) pbFlip = p.replace('flip=','') === '1';
      else if (p.indexOf('mapping=') === 0) pbMappingId = p.replace('mapping=','');
      else if (p.indexOf('mappingBase=') === 0) pbMappingBaseId = p.replace('mappingBase=','');
      else if (p.indexOf('mappingType=') === 0) pbMappingType = p.replace('mappingType=','');
      else if (p.indexOf('mappingOffset=') === 0) pbMappingOffset = p.replace('mappingOffset=','');
      else if (p.indexOf('customMap=') === 0) {
        try {
          pbCustomMap = JSON.parse(decodeURIComponent(p.replace('customMap=','')));
        } catch(e) { pbCustomMap = null; }
      }
      else if (p.indexOf('=') > 0) {
        var pop = 'eq';
        var pval = p;
        if (p.indexOf('!=') > 0) { pop = 'ne'; pval = p.replace('!=','='); }
        var kv = pval.split('=');
        if (kv.length === 2 && kv[1]) {
          pbPositions[kv[0]] = { op: pop, val: kv[1] };
        }
      }
    }
    // 取值维度优先级：断语规则默认(最高) > 字段自身 > 条件宏默认
    if (ruleDefaultQuZhi) {
      pbQuZhi = ruleDefaultQuZhi;
    }
    if (!pbQuZhi && macroDefaultQuZhi) {
      pbQuZhi = macroDefaultQuZhi;
    }
    // 映射规则层级覆盖：断语级 > 条件宏级 > 字段级
    // 仅对映射引用模式（pbMappingBaseId 非空）或字段级有 mapping 时生效
    if (pbMappingBaseId || pbMappingId) {
      var fieldTypeForMapping = pbType; // "十神组" / "五行"
      var mappingRulesList = data && data.mappingRules ? data.mappingRules : null;
      // 也尝试从 localStorage 缓存读取（API场景下 data 可能不传）
      if (!mappingRulesList && typeof localStorage !== 'undefined') {
        try {
          var rawRules = localStorage.getItem('pb_mapping_rules');
          if (rawRules) mappingRulesList = JSON.parse(rawRules);
        } catch(e) {}
      }
      var resolvedMap = resolveDefaultMapping(fieldTypeForMapping, ruleDefaultMapping, macroDefaultMapping, pbMappingId, mappingRulesList);
      // 仅断语级/条件宏级 defaultMapping 生效时用规则当前值覆盖字段快照；
      // 字段级回退（_source='field'）时保留字段编码中的快照值，避免规则修改后旧配置行为突变
      if (resolvedMap && resolvedMap._source !== 'field') {
        pbMappingType = resolvedMap.mappingType;
        pbMappingOffset = resolvedMap.mappingOffset;
        pbCustomMap = resolvedMap.customMap;
        pbMappingId = resolvedMap._ruleId;
      }
    }
    // 判断一个排列段是否为元信息（非位置条件）
    var _isMetaSeg = function(s) {
      return s === '定位批量' ||
        s.indexOf('type=') === 0 || s.indexOf('ganZhi=') === 0 ||
        s.indexOf('scope=') === 0 || s.indexOf('取值=') === 0 ||
        s.indexOf('inherit=') === 0 || s.indexOf('flip=') === 0 ||
        s.indexOf('mapping=') === 0 || s.indexOf('mappingBase=') === 0 ||
        s.indexOf('mappingType=') === 0 || s.indexOf('mappingOffset=') === 0 ||
        s.indexOf('customMap=') === 0 ||
        s.indexOf('inc包含=') === 0 || s.indexOf('inc排除=') === 0;
    };
    // 把一个排列编码解析为 positions 对象
    var _parseArrangementToPositions = function(arrVal) {
      var posObj = {};
      if (!arrVal || arrVal.indexOf('定位批量|') !== 0) return posObj;
      var aParts = arrVal.split('|');
      for (var ai2 = 0; ai2 < aParts.length; ai2++) {
        var ap = aParts[ai2];
        if (_isMetaSeg(ap)) continue;
        if (ap.indexOf('=') > 0) {
          var aop = 'eq';
          var aval = ap;
          if (ap.indexOf('!=') > 0) { aop = 'ne'; aval = ap.replace('!=','='); }
          var akv = aval.split('=');
          if (akv.length === 2 && akv[1]) {
            posObj[akv[0]] = { op: aop, val: akv[1] };
          }
        }
      }
      return posObj;
    };

    if (pbMappingBaseId) {
      // mapping 模式：基于基准条件宏的排列 + 映射转换 + 增量条件
      var mVisited = {};
      var mArrangements = extractInheritArrangements(data, pbMappingBaseId, mVisited);
      // 获取基准宏的默认取值维度
      var mapMacroDefQz = getMacroDefaultQuZhi(data, pbMappingBaseId);
      if (mArrangements.length === 0) {
        res = false;
      } else {
        res = false;
        for (var mai = 0; mai < mArrangements.length; mai++) {
          // 对基准排列应用映射转换（仅转换位置条件的值）
          var mappedArr = applyMappingToArrangement(mArrangements[mai], pbMappingType, pbMappingOffset, pbCustomMap);
          // 解析映射后的排列得到 positions
          var mappedPositions = _parseArrangementToPositions(mappedArr);
          // 追加增量位置（覆盖同名位置）
          for (var incNameM in pbPositions) {
            mappedPositions[incNameM] = pbPositions[incNameM];
          }
          // 从基准排列中提取 ganZhi 和取值维度
          // 优先级：断语规则默认(最高) > 当前字段设置 > 当前宏默认(defaultQuZhi) > 基准宏默认 > 基准排列中的取值
          var mapGanZhi = pbGanZhi;
          var mapQuZhi = pbQuZhi;
          if (ruleDefaultQuZhi) mapQuZhi = ruleDefaultQuZhi;
          if (!mapQuZhi && macroDefaultQuZhi) mapQuZhi = macroDefaultQuZhi;
          if (!mapQuZhi && mapMacroDefQz) mapQuZhi = mapMacroDefQz;
          var mapParts = mArrangements[mai].split('|');
          for (var mpi = 0; mpi < mapParts.length; mpi++) {
            if (mapParts[mpi].indexOf('ganZhi=') === 0) {
              var mArrGz = mapParts[mpi].replace('ganZhi=','');
              if (mapGanZhi === '通用' && mArrGz !== '通用') mapGanZhi = mArrGz;
            } else if (mapParts[mpi].indexOf('取值=') === 0) {
              if (!mapQuZhi) mapQuZhi = mapParts[mpi].replace('取值=','');
            }
          }
          // 判断（含原局翻转）
          if (evaluateBatchPositionsFlip(data, mappedPositions, pbType, mapGanZhi, mapQuZhi, pbFlip)) {
            res = true;
            break;
          }
        }
      }
      actual = val;
    } else if (pbInheritId) {
      // inherit 模式：递归展开被继承条件宏的排列 + 增量条件
      var visited = {};
      var arrangements = extractInheritArrangements(data, pbInheritId, visited);
      // 获取被引用宏的默认取值维度
      var inhMacroDefQz = getMacroDefaultQuZhi(data, pbInheritId);
      // 对每个排列追加增量位置条件，逐个判断，任一满足即 true
      if (arrangements.length === 0) {
        res = false;
      } else {
        res = false;
        for (var ai = 0; ai < arrangements.length; ai++) {
          // 合并：继承排列的位置 + 增量位置
          var mergedPositions = _parseArrangementToPositions(arrangements[ai]);
          // 追加增量位置（覆盖同名位置）
          for (var incName in pbPositions) {
            mergedPositions[incName] = pbPositions[incName];
          }
          // 从被引用排列中提取 ganZhi 和取值维度
          // 优先级：断语规则默认(最高) > 当前字段设置 > 当前宏默认(defaultQuZhi) > 被引用宏默认 > 被引用排列中的取值
          var inhGanZhi = pbGanZhi;
          var inhQuZhi = pbQuZhi;
          if (ruleDefaultQuZhi) inhQuZhi = ruleDefaultQuZhi;
          if (!inhQuZhi && macroDefaultQuZhi) inhQuZhi = macroDefaultQuZhi;
          if (!inhQuZhi && inhMacroDefQz) inhQuZhi = inhMacroDefQz;
          var inhParts = arrangements[ai].split('|');
          for (var ipi = 0; ipi < inhParts.length; ipi++) {
            if (inhParts[ipi].indexOf('ganZhi=') === 0) {
              var arrGz = inhParts[ipi].replace('ganZhi=','');
              if (inhGanZhi === '通用' && arrGz !== '通用') inhGanZhi = arrGz;
            } else if (inhParts[ipi].indexOf('取值=') === 0) {
              if (!inhQuZhi) inhQuZhi = inhParts[ipi].replace('取值=','');
            }
          }
          // 判断（含原局翻转）
          if (evaluateBatchPositionsFlip(data, mergedPositions, pbType, inhGanZhi, inhQuZhi, pbFlip)) {
            res = true;
            break;
          }
        }
      }
      actual = val;
    } else {
      // 普通模式
      res = evaluateBatchPositionsFlip(data, pbPositions, pbType, pbGanZhi, pbQuZhi, pbFlip);
      actual = val;
    }
  }

  // ---- 批量包含判断 ----
  else if (field.indexOf('批量包含-') === 0 && val && val.indexOf('批量包含|') === 0) {
    var biDbg = function(msg){ if (data && Array.isArray(data.biDebug)) data.biDebug.push(msg); };
    biDbg('[批量包含] 字段=' + field + ' 编码=' + val);
    var biParts = val.split('|');
    var biType = '十神组', biGanZhi = '通用', biScope = '原局';
    var biInclude = [], biExclude = [];
    var biMappingBase = '', biMappingRule = '', biMappingType = '', biMappingOffset = '';
    var biCustomMap = null, biInc2 = [], biExc2 = [];
    for (var bipi = 0; bipi < biParts.length; bipi++) {
      var bp = biParts[bipi];
      if (bp === '批量包含') continue;
      if (bp.indexOf('type=') === 0) biType = bp.replace('type=','');
      else if (bp.indexOf('ganZhi=') === 0) biGanZhi = bp.replace('ganZhi=','');
      else if (bp.indexOf('scope=') === 0) biScope = bp.replace('scope=','');
      else if (bp.indexOf('包含=') === 0) {
        var incStr = bp.replace('包含=','');
        if (incStr) biInclude = incStr.split(',');
      }
      else if (bp.indexOf('排除=') === 0) {
        var excStr = bp.replace('排除=','');
        if (excStr) biExclude = excStr.split(',');
      }
      else if (bp.indexOf('mappingBase=') === 0) biMappingBase = bp.replace('mappingBase=','');
      else if (bp.indexOf('mapping=') === 0) biMappingRule = bp.replace('mapping=','');
      else if (bp.indexOf('mappingType=') === 0) biMappingType = bp.replace('mappingType=','');
      else if (bp.indexOf('mappingOffset=') === 0) biMappingOffset = bp.replace('mappingOffset=','');
      else if (bp.indexOf('customMap=') === 0) {
        try { biCustomMap = JSON.parse(decodeURIComponent(bp.replace('customMap=',''))); } catch(e) {}
      }
      else if (bp.indexOf('inc包含=') === 0) {
        var inc2Str = bp.replace('inc包含=','');
        if (inc2Str) biInc2 = inc2Str.split(',');
      }
      else if (bp.indexOf('inc排除=') === 0) {
        var exc2Str = bp.replace('inc排除=','');
        if (exc2Str) biExc2 = exc2Str.split(',');
      }
    }
    biDbg('  解析: type=' + biType + ' ganZhi=' + biGanZhi + ' scope=' + biScope + ' include=[' + biInclude.join(',') + '] exclude=[' + biExclude.join(',') + '] 增量包含=[' + biInc2.join(',') + '] 增量排除=[' + biExc2.join(',') + ']');

    // 映射规则层级覆盖：断语级 > 条件宏级 > 字段级
    if (biMappingBase || biMappingRule) {
      var biFieldTypeForMapping = biType; // "十神组" / "五行"
      var biMappingRulesList = data && data.mappingRules ? data.mappingRules : null;
      if (!biMappingRulesList && typeof localStorage !== 'undefined') {
        try {
          var biRawRules = localStorage.getItem('pb_mapping_rules');
          if (biRawRules) biMappingRulesList = JSON.parse(biRawRules);
        } catch(e) {}
      }
      var biResolvedMap = resolveDefaultMapping(biFieldTypeForMapping, ruleDefaultMapping, macroDefaultMapping, biMappingRule, biMappingRulesList);
      var biFieldSnapshotRule = biMappingRule;
      // 仅断语级/条件宏级 defaultMapping 生效时用规则当前值覆盖字段快照；
      // 字段级回退（_source='field'）时保留字段编码中的快照值，避免规则修改后旧配置行为突变
      if (biResolvedMap && biResolvedMap._source !== 'field') {
        biMappingType = biResolvedMap.mappingType;
        biMappingOffset = biResolvedMap.mappingOffset;
        biCustomMap = biResolvedMap.customMap;
        biMappingRule = biResolvedMap._ruleId;
      }
      biDbg('  映射规则: 字段快照 rule=' + (biFieldSnapshotRule || '空') + ' 生效 ruleId=' + (biMappingRule || '空') + ' type=' + (biMappingType || '空') + ' offset=' + (biMappingOffset || '空') + ' customMap=' + (biCustomMap ? JSON.stringify(biCustomMap) : 'null'));
    }

    // 取值维度优先级：断语规则默认(最高) > 字段自身 > 条件宏默认
    var biQuZhi = '';
    if (ruleDefaultQuZhi) biQuZhi = ruleDefaultQuZhi;
    if (!biQuZhi && biGanZhi !== '通用') biQuZhi = biGanZhi;
    if (!biQuZhi && macroDefaultQuZhi) biQuZhi = macroDefaultQuZhi;
    // 实际收集取值维度：通用（未指定）时后备为天干
    var biActualGzFinal = biQuZhi || (biGanZhi !== '通用' ? biGanZhi : '天干');
    biDbg('  取值维度: 规则默认=' + (ruleDefaultQuZhi || '空') + ' 字段=' + biGanZhi + ' 宏默认=' + (macroDefaultQuZhi || '空') + ' → 最终收集=' + biActualGzFinal);

    // 如果是映射模式，从基准宏获取配置并应用映射（映射规则可选，未选时恒等映射）
    // 基准宏内多个批量包含字段为"或"关系（任一满足即通过），因此每条配置作为独立候选，
    // 不再把所有 include/exclude 合并成一个大集合后 AND 判断（避免"须出现与不许出现"矛盾导致多值恒不匹配）
    var biBaseMacro = null;
    var biCandidates = [];
    if (biMappingBase) {
      // 通过 idMapping 解析基准宏（mappingBase 可能是本地ID，云端需解析为 cloudId）
      biBaseMacro = findMacroById(data, biMappingBase);
      biDbg('  基准宏: mappingBase=' + biMappingBase + ' → ' + (biBaseMacro ? '找到(' + (biBaseMacro.name || '') + ')' : '未找到(fail-closed)'));
      if (biBaseMacro) {
        var biConfigs = _extractBiConfigsFromMacro(biBaseMacro, biType, data && data.macros ? data.macros : [], data);
        biDbg('  基准宏提取配置数=' + biConfigs.length);
        var bcRule = { type: biMappingType, offset: biMappingOffset, customMap: biCustomMap };
        for (var bci = 0; bci < biConfigs.length; bci++) {
          var bc = biConfigs[bci];
          // 【修复】ganZhi 兼容判断：基准配置为"通用"（不指定维度）或与最终收集维度一致时均可合并，
          // 避免映射引用的配置因维度写法不一致（通用 vs 天干/地支）被误过滤，导致多值时不匹配
          var bcGzOk = bc.ganZhi === '通用' || bc.ganZhi === biActualGzFinal;
          biDbg('    config[' + bci + ']: type=' + bc.type + ' ganZhi=' + bc.ganZhi + ' scope=' + bc.scope + ' include=[' + (bc.include||[]).join(',') + '] exclude=[' + (bc.exclude||[]).join(',') + '] 维度兼容=' + bcGzOk + ' scope一致=' + (bc.scope === biScope));
          if (bcGzOk && bc.scope === biScope) {
            var bcMapped = _mapBiConfigValues(bc, bcRule);
            biCandidates.push({ include: bcMapped.include || [], exclude: bcMapped.exclude || [] });
          }
        }
      }
    }
    biDbg('  合并候选数=' + biCandidates.length + ' → ' + biCandidates.map(function(c){ return '[' + c.include.join(',') + ']/[' + c.exclude.join(',') + ']'; }).join(' | '));

    // 映射引用模式且基准宏无法解析 → 判定不满足（fail-closed）
    // 无任何包含/排除配置可判定 → 判定不满足（fail-closed），
    // 避免 include=[] 导致 every() 恒真而误匹配所有断语（与定位批量 inherit/mapping 行为一致）
    var hasAnyBiConstraint = biInclude.length > 0 || biExclude.length > 0 || biCandidates.length > 0 || biInc2.length > 0 || biExc2.length > 0;
    if (biMappingBase && !biBaseMacro) {
      res = false;
      actual = val;
      biDbg('  判定: ❌ 不匹配（基准宏未找到 fail-closed）');
    } else if (!hasAnyBiConstraint) {
      res = false;
      actual = val;
      biDbg('  判定: ❌ 不匹配（无任何包含/排除配置可判定 fail-closed）');
    } else {
      // 确定实际取值维度
      var actualBiGz = biActualGzFinal;

      // 确定要收集的柱位
      var biPillars = [];
      if (biScope === '原局') biPillars = ['nian','yue','ri','shi'];
      else if (biScope === '原局+大运') biPillars = ['nian','yue','ri','shi','dayun'];
      else if (biScope === '原局+大运+流年') biPillars = ['nian','yue','ri','shi','dayun','liunian'];
      else biPillars = ['nian','yue','ri','shi'];

      // 收集实际值
      var biActualVals = [];
      var biRg = data.ri ? data.ri.t : '';
      for (var bpi = 0; bpi < biPillars.length; bpi++) {
        var biPillar = data[biPillars[bpi]];
        if (!biPillar) continue;
        var biNode = (actualBiGz === '地支') ? biPillar.d : biPillar.t;
        if (!biNode) continue;
        var biVal = '';
        if (biType === '五行') {
          biVal = WU_XING[biNode] || '';
        } else if (biType === '十神') {
          biVal = (actualBiGz === '地支') ? getDiShen(biNode, biRg) : getExactShen(biNode, biRg);
        } else if (biType === '十神组') {
          var biShenTmp = (actualBiGz === '地支') ? getDiShen(biNode, biRg) : getExactShen(biNode, biRg);
          biVal = SHEN_TO_GROUP[biShenTmp] || '';
        }
        if (biVal && biActualVals.indexOf(biVal) < 0) biActualVals.push(biVal);
      }

      // 字段自身直接包含/排除（映射模式下一般为空）：全部满足
      var biDirectOk = true;
      for (var bdi = 0; bdi < biInclude.length; bdi++) {
        if (biActualVals.indexOf(biInclude[bdi]) < 0) { biDirectOk = false; break; }
      }
      if (biDirectOk) {
        for (var bde = 0; bde < biExclude.length; bde++) {
          if (biActualVals.indexOf(biExclude[bde]) >= 0) { biDirectOk = false; break; }
        }
      }
      // 基准宏候选：每条配置为"或"关系，任一满足即通过
      // （修复：多值不匹配——原实现把全部配置合并成一个大集合后 AND 判断，
      //   产生"须出现与不许出现"互相矛盾的约束，导致基准宏含多字段时恒不匹配）
      var biCandidateOk = biCandidates.length === 0;
      for (var bci2 = 0; bci2 < biCandidates.length; bci2++) {
        var biCand = biCandidates[bci2];
        var biCandInOk = true;
        for (var bci3 = 0; bci3 < biCand.include.length; bci3++) {
          if (biActualVals.indexOf(biCand.include[bci3]) < 0) { biCandInOk = false; break; }
        }
        var biCandExOk = true;
        if (biCandInOk) {
          for (var bci4 = 0; bci4 < biCand.exclude.length; bci4++) {
            if (biActualVals.indexOf(biCand.exclude[bci4]) >= 0) { biCandExOk = false; break; }
          }
        }
        if (biCandInOk && biCandExOk) { biCandidateOk = true; break; }
      }
      // 增量包含/排除（inc包含/inc排除）：全部满足（与合并前行为一致）
      var biIncOk = true;
      for (var bij = 0; bij < biInc2.length; bij++) {
        if (biActualVals.indexOf(biInc2[bij]) < 0) { biIncOk = false; break; }
      }
      if (biIncOk) {
        for (var bij2 = 0; bij2 < biExc2.length; bij2++) {
          if (biActualVals.indexOf(biExc2[bij2]) >= 0) { biIncOk = false; break; }
        }
      }
      res = biDirectOk && biCandidateOk && biIncOk;
      actual = val;
      var biFailReason = '';
      if (!biDirectOk) biFailReason += '字段值未满足';
      if (!biCandidateOk) biFailReason += (biFailReason ? '; ' : '') + '基准宏候选未满足';
      if (!biIncOk) biFailReason += (biFailReason ? '; ' : '') + '增量未满足';
      biDbg('  八字实际值(' + actualBiGz + ',' + biScope + ')=[' + biActualVals.join(',') + '] → 判定: ' + (res ? '✅ 匹配' : '❌ 不匹配（' + biFailReason + '）'));
    }
  }

  // ---- 天干/地支直接对比 ----
  else if (['年干','月干','日干','时干','大运干','流年干','流月干'].indexOf(field) >= 0) {
    actual = getFieldValue(data, field);
    if (op === 'eq') res = actual === val;
    else if (op === 'ne') res = actual !== val;
  }
  else if (['年支','月支','日支','时支','大运支','流年支','流月支'].indexOf(field) >= 0) {
    actual = getFieldValue(data, field);
    if (op === 'eq') res = actual === val;
    else if (op === 'ne') res = actual !== val;
  }

  // ---- 五行对比 ----
  else if (field.indexOf('五行') >= 0 && field.indexOf('数量') < 0 && field.indexOf('包含') !== 0) {
    var pos = field.replace('五行', '');
    var pathMap = {
      '年干': 'nian.t','年支': 'nian.d','月干': 'yue.t','月支': 'yue.d',
      '日干': 'ri.t','日支': 'ri.d','时干': 'shi.t','时支': 'shi.d',
      '大运干': 'dayun.t','大运支': 'dayun.d','流年干': 'liunian.t','流年支': 'liunian.d',
      '流月干': 'liuyue.t','流月支': 'liuyue.d'
    };
    var key = pathMap[pos];
    if (key) {
      var parts = key.split('.');
      var k = parts[0], p = parts[1];
      actual = data[k] ? (WU_XING[data[k][p]] || '') : '';
      if (op === 'eq') res = actual === val;
      else if (op === 'ne') res = actual !== val;
    }
  }

  // ---- 十神对比 ----
  else if (field.indexOf('十神') >= 0 && field.indexOf('数量') < 0 && field.indexOf('包含') !== 0 && field.indexOf('十神组') < 0) {
    var pos = field.replace('十神', '');
    var pathMap = {
      '年干': 'nian.t','年支': 'nian.d','月干': 'yue.t','月支': 'yue.d',
      '日干': 'ri.t','日支': 'ri.d','时干': 'shi.t','时支': 'shi.d',
      '大运干': 'dayun.t','大运支': 'dayun.d','流年干': 'liunian.t','流年支': 'liunian.d',
      '流月干': 'liuyue.t','流月支': 'liuyue.d'
    };
    var key = pathMap[pos];
    if (key && data.ri && data.ri.t) {
      var parts = key.split('.');
      var k = parts[0], p = parts[1];
      var v = data[k] ? data[k][p] : '';
      actual = p === 't' ? getExactShen(v, data.ri.t) : getDiShen(v, data.ri.t);
      if (op === 'eq') res = actual === val;
      else if (op === 'ne') res = actual !== val;
    }
  }

  // ---- 十神组对比 ----
  else if (field.indexOf('十神组') >= 0 && field.indexOf('包含') !== 0) {
    var pos = field.replace('十神组', '');
    var pathMap = {
      '年干': 'nian.t','年支': 'nian.d','月干': 'yue.t','月支': 'yue.d',
      '日干': 'ri.t','日支': 'ri.d','时干': 'shi.t','时支': 'shi.d',
      '大运干': 'dayun.t','大运支': 'dayun.d','流年干': 'liunian.t','流年支': 'liunian.d',
      '流月干': 'liuyue.t','流月支': 'liuyue.d'
    };
    var key = pathMap[pos];
    if (key && data.ri && data.ri.t) {
      var parts = key.split('.');
      var k = parts[0], p = parts[1];
      var v = data[k] ? data[k][p] : '';
      var shen = p === 't' ? getExactShen(v, data.ri.t) : getDiShen(v, data.ri.t);
      actual = SHEN_TO_GROUP[shen] || '';
      var expected = val === '财' ? '财星' : val === '印' ? '印星' : val;
      if (op === 'eq') res = actual === expected;
      else if (op === 'ne') res = actual !== expected;
    }
  }

  // ---- 五行数量对比（field 和 val 都是五行数量字段） ----
  else if (field.indexOf('五行数量-') >= 0 && val && val.indexOf('五行数量-') >= 0) {
    function _countWuxingByScope(fieldName) {
      var fName = fieldName.substring(fieldName.lastIndexOf('-') + 1);
      var fHasDayun = fieldName.indexOf('大运') >= 0;
      var fHasLiunian = fieldName.indexOf('流年') >= 0;
      var fHasYuanJu = fieldName.indexOf('原局') >= 0;
      var fCnt = 0;
      if (fHasYuanJu || (!fHasDayun && !fHasLiunian)) {
        if (data.nian && data.nian.t && WU_XING[data.nian.t] === fName) fCnt++;
        if (data.yue && data.yue.t && WU_XING[data.yue.t] === fName) fCnt++;
        if (data.ri && data.ri.t && WU_XING[data.ri.t] === fName) fCnt++;
        if (data.shi && data.shi.t && WU_XING[data.shi.t] === fName) fCnt++;
        if (data.nian && data.nian.d && WU_XING[data.nian.d] === fName) fCnt++;
        if (data.yue && data.yue.d && WU_XING[data.yue.d] === fName) fCnt++;
        if (data.ri && data.ri.d && WU_XING[data.ri.d] === fName) fCnt++;
        if (data.shi && data.shi.d && WU_XING[data.shi.d] === fName) fCnt++;
      }
      if (fHasDayun) {
        if (data.dayun && data.dayun.t && WU_XING[data.dayun.t] === fName) fCnt++;
        if (data.dayun && data.dayun.d && WU_XING[data.dayun.d] === fName) fCnt++;
      }
      if (fHasLiunian) {
        if (data.liunian && data.liunian.t && WU_XING[data.liunian.t] === fName) fCnt++;
        if (data.liunian && data.liunian.d && WU_XING[data.liunian.d] === fName) fCnt++;
      }
      return fCnt;
    }
    var _cntC = _countWuxingByScope(field);
    var _cntD = _countWuxingByScope(val);
    if (op === 'eq') res = _cntC == _cntD;
    else if (op === 'ge') res = _cntC >= _cntD;
    else if (op === 'gt') res = _cntC > _cntD;
    else if (op === 'le') res = _cntC <= _cntD;
    else if (op === 'lt') res = _cntC < _cntD;
    actual = field + '=' + _cntC + ', ' + val + '=' + _cntD;
  }

  // ---- 五行数量（统一处理所有前缀变体） ----
  else if (field.indexOf('五行数量-') >= 0) {
    var name = field.substring(field.lastIndexOf('-') + 1);
    var hasDayun = field.indexOf('大运') >= 0;
    var hasLiunian = field.indexOf('流年') >= 0;
    var hasYuanJu = field.indexOf('原局') >= 0;
    var onlyTiangan = field.indexOf('天干') >= 0;
    var onlyDizhi = field.indexOf('地支') >= 0;
    var cnt = 0;
    // 仅当字段名含"原局"、或不含"大运流年"时，才统计原局四柱
    if (hasYuanJu || (!hasDayun && !hasLiunian)) {
      if (!onlyDizhi) {
        if (data.nian && data.nian.t && WU_XING[data.nian.t] === name) cnt++;
        if (data.yue && data.yue.t && WU_XING[data.yue.t] === name) cnt++;
        if (data.ri && data.ri.t && WU_XING[data.ri.t] === name) cnt++;
        if (data.shi && data.shi.t && WU_XING[data.shi.t] === name) cnt++;
      }
      if (!onlyTiangan) {
        if (data.nian && data.nian.d && WU_XING[data.nian.d] === name) cnt++;
        if (data.yue && data.yue.d && WU_XING[data.yue.d] === name) cnt++;
        if (data.ri && data.ri.d && WU_XING[data.ri.d] === name) cnt++;
        if (data.shi && data.shi.d && WU_XING[data.shi.d] === name) cnt++;
      }
    }
    if (hasDayun) {
      if (!onlyDizhi && data.dayun && data.dayun.t && WU_XING[data.dayun.t] === name) cnt++;
      if (!onlyTiangan && data.dayun && data.dayun.d && WU_XING[data.dayun.d] === name) cnt++;
    }
    if (hasLiunian) {
      if (!onlyDizhi && data.liunian && data.liunian.t && WU_XING[data.liunian.t] === name) cnt++;
      if (!onlyTiangan && data.liunian && data.liunian.d && WU_XING[data.liunian.d] === name) cnt++;
    }
    if (op === 'eq') res = cnt == Number(val);
    else if (op === 'ge') res = cnt >= Number(val);
    else if (op === 'gt') res = cnt > Number(val);
    else if (op === 'le') res = cnt <= Number(val);
    else if (op === 'lt') res = cnt < Number(val);
    actual = String(cnt);
  }

  // ---- 十神数量对比（field 和 val 都是十神数量字段） ----
  else if (field.indexOf('十神数量-') >= 0 && val && val.indexOf('十神数量-') >= 0) {
    function _countShishenByScope(fieldName) {
      var fName = fieldName.substring(fieldName.lastIndexOf('-') + 1);
      var fHasDayun = fieldName.indexOf('大运') >= 0;
      var fHasLiunian = fieldName.indexOf('流年') >= 0;
      var fHasYuanJu = fieldName.indexOf('原局') >= 0;
      var fOnlyTiangan = fieldName.indexOf('天干') >= 0;
      var fOnlyDizhi = fieldName.indexOf('地支') >= 0;
      var fIsGroup = ['比劫','食伤','财星','官杀','印星'].indexOf(fName) >= 0;
      var fCnt = 0;
      if (data.ri && data.ri.t) {
        var fRg = data.ri.t;
        if (fHasYuanJu || (!fHasDayun && !fHasLiunian)) {
          if (!fOnlyDizhi) {
            if (data.nian && data.nian.t) { var s = getExactShen(data.nian.t, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
            if (data.yue && data.yue.t) { var s = getExactShen(data.yue.t, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
            if (data.ri && data.ri.t) { var s = getExactShen(data.ri.t, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
            if (data.shi && data.shi.t) { var s = getExactShen(data.shi.t, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
          }
          if (!fOnlyTiangan) {
            if (data.nian && data.nian.d) { var s = getDiShen(data.nian.d, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
            if (data.yue && data.yue.d) { var s = getDiShen(data.yue.d, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
            if (data.ri && data.ri.d) { var s = getDiShen(data.ri.d, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
            if (data.shi && data.shi.d) { var s = getDiShen(data.shi.d, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
          }
        }
        if (fHasDayun) {
          if (!fOnlyDizhi && data.dayun && data.dayun.t) { var s = getExactShen(data.dayun.t, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
          if (!fOnlyTiangan && data.dayun && data.dayun.d) { var s = getDiShen(data.dayun.d, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
        }
        if (fHasLiunian) {
          if (!fOnlyDizhi && data.liunian && data.liunian.t) { var s = getExactShen(data.liunian.t, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
          if (!fOnlyTiangan && data.liunian && data.liunian.d) { var s = getDiShen(data.liunian.d, fRg); if (fIsGroup ? (SHEN_TO_GROUP[s] === fName) : (s === fName)) fCnt++; }
        }
      }
      return fCnt;
    }
    var _cntA = _countShishenByScope(field);
    var _cntB = _countShishenByScope(val);
    if (op === 'eq') res = _cntA == _cntB;
    else if (op === 'ge') res = _cntA >= _cntB;
    else if (op === 'gt') res = _cntA > _cntB;
    else if (op === 'le') res = _cntA <= _cntB;
    else if (op === 'lt') res = _cntA < _cntB;
    actual = field + '=' + _cntA + ', ' + val + '=' + _cntB;
  }

  // ---- 十神数量（统一处理所有前缀变体） ----
  else if (field.indexOf('十神数量-') >= 0) {
    var name = field.substring(field.lastIndexOf('-') + 1);
    var hasDayun = field.indexOf('大运') >= 0;
    var hasLiunian = field.indexOf('流年') >= 0;
    var hasYuanJu = field.indexOf('原局') >= 0;
    var onlyTiangan = field.indexOf('天干') >= 0;
    var onlyDizhi = field.indexOf('地支') >= 0;
    var isGroup = ['比劫','食伤','财星','官杀','印星'].indexOf(name) >= 0;

    if (!data.ri || !data.ri.t) { res = false; } else {
      var cnt = 0;
      var rg = data.ri.t;
      // 仅当字段名含"原局"、或不含"大运流年"时，才统计原局四柱
      if (hasYuanJu || (!hasDayun && !hasLiunian)) {
        if (!onlyDizhi) {
          if (data.nian && data.nian.t) { var s = getExactShen(data.nian.t, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
          if (data.yue && data.yue.t) { var s = getExactShen(data.yue.t, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
          if (data.ri && data.ri.t) { var s = getExactShen(data.ri.t, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
          if (data.shi && data.shi.t) { var s = getExactShen(data.shi.t, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
        }
        if (!onlyTiangan) {
          if (data.nian && data.nian.d) { var s = getDiShen(data.nian.d, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
          if (data.yue && data.yue.d) { var s = getDiShen(data.yue.d, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
          if (data.ri && data.ri.d) { var s = getDiShen(data.ri.d, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
          if (data.shi && data.shi.d) { var s = getDiShen(data.shi.d, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
        }
      }
      if (hasDayun) {
        if (!onlyDizhi && data.dayun && data.dayun.t) { var s = getExactShen(data.dayun.t, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
        if (!onlyTiangan && data.dayun && data.dayun.d) { var s = getDiShen(data.dayun.d, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
      }
      if (hasLiunian) {
        if (!onlyDizhi && data.liunian && data.liunian.t) { var s = getExactShen(data.liunian.t, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
        if (!onlyTiangan && data.liunian && data.liunian.d) { var s = getDiShen(data.liunian.d, rg); if (isGroup ? (SHEN_TO_GROUP[s] === name) : (s === name)) cnt++; }
      }
      if (op === 'eq') res = cnt == Number(val);
      else if (op === 'ge') res = cnt >= Number(val);
      else if (op === 'gt') res = cnt > Number(val);
      else if (op === 'le') res = cnt <= Number(val);
      else if (op === 'lt') res = cnt < Number(val);
      actual = String(cnt);
    }
  }

  // ---- 月支十神/月支十神组 ----
  else if (field === '月支十神' && data.yue && data.yue.d && data.ri && data.ri.t) {
    actual = getDiShen(data.yue.d, data.ri.t);
    if (op === 'eq') res = actual === val;
    else if (op === 'ne') res = actual !== val;
  }
  else if (field === '月支十神组' && data.yue && data.yue.d && data.ri && data.ri.t) {
    var s = getDiShen(data.yue.d, data.ri.t);
    actual = SHEN_TO_GROUP[s] || s;
    var expected = val === '财' ? '财星' : val === '印' ? '印星' : val;
    if (op === 'eq') res = actual === expected;
    else if (op === 'ne') res = actual !== expected;
  }

  // ---- 包含- 字段 ----
  else if (field.indexOf('包含-') === 0) {
    var fieldType = field.replace('包含-', '');
    var targetValues = val.split(',').filter(function(v) { return v; });
    var sourceValues = [];
    var _baziPillars = [data.nian, data.yue, data.ri, data.shi];

    if (fieldType === '八字天干五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t) sourceValues.push(WU_XING[_baziPillars[_bi].t] || '');
      }
    }
    else if (fieldType === '八字地支五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d) sourceValues.push(WU_XING[_baziPillars[_bi].d] || '');
      }
    }
    else if (fieldType === '八字大运天干五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t) sourceValues.push(WU_XING[_baziPillars[_bi].t] || '');
      }
      if (data.dayun && data.dayun.t) sourceValues.push(WU_XING[data.dayun.t] || '');
    }
    else if (fieldType === '八字大运地支五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d) sourceValues.push(WU_XING[_baziPillars[_bi].d] || '');
      }
      if (data.dayun && data.dayun.d) sourceValues.push(WU_XING[data.dayun.d] || '');
    }
    else if (fieldType === '八字大运流年天干五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t) sourceValues.push(WU_XING[_baziPillars[_bi].t] || '');
      }
      if (data.dayun && data.dayun.t) sourceValues.push(WU_XING[data.dayun.t] || '');
      if (data.liunian && data.liunian.t) sourceValues.push(WU_XING[data.liunian.t] || '');
    }
    else if (fieldType === '八字大运流年地支五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d) sourceValues.push(WU_XING[_baziPillars[_bi].d] || '');
      }
      if (data.dayun && data.dayun.d) sourceValues.push(WU_XING[data.dayun.d] || '');
      if (data.liunian && data.liunian.d) sourceValues.push(WU_XING[data.liunian.d] || '');
    }
    else if (fieldType === '八字大运流年流月天干五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t) sourceValues.push(WU_XING[_baziPillars[_bi].t] || '');
      }
      if (data.dayun && data.dayun.t) sourceValues.push(WU_XING[data.dayun.t] || '');
      if (data.liunian && data.liunian.t) sourceValues.push(WU_XING[data.liunian.t] || '');
      if (data.liuyue && data.liuyue.t) sourceValues.push(WU_XING[data.liuyue.t] || '');
    }
    else if (fieldType === '八字大运流年流月地支五行') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d) sourceValues.push(WU_XING[_baziPillars[_bi].d] || '');
      }
      if (data.dayun && data.dayun.d) sourceValues.push(WU_XING[data.dayun.d] || '');
      if (data.liunian && data.liunian.d) sourceValues.push(WU_XING[data.liunian.d] || '');
      if (data.liuyue && data.liuyue.d) sourceValues.push(WU_XING[data.liuyue.d] || '');
    }
    else if (fieldType === '八字天干十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) sourceValues.push(getExactShen(_baziPillars[_bi].t, data.ri.t));
      }
    }
    else if (fieldType === '八字地支十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) sourceValues.push(getDiShen(_baziPillars[_bi].d, data.ri.t));
      }
    }
    else if (fieldType === '八字大运天干十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) sourceValues.push(getExactShen(_baziPillars[_bi].t, data.ri.t));
      }
      if (data.dayun && data.dayun.t && data.ri && data.ri.t) sourceValues.push(getExactShen(data.dayun.t, data.ri.t));
    }
    else if (fieldType === '八字大运地支十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) sourceValues.push(getDiShen(_baziPillars[_bi].d, data.ri.t));
      }
      if (data.dayun && data.dayun.d && data.ri && data.ri.t) sourceValues.push(getDiShen(data.dayun.d, data.ri.t));
    }
    else if (fieldType === '八字天干十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) {
          var _s = getExactShen(_baziPillars[_bi].t, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
    }
    else if (fieldType === '八字地支十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) {
          var _s = getDiShen(_baziPillars[_bi].d, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
    }
    else if (fieldType === '八字大运天干十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) {
          var _s = getExactShen(_baziPillars[_bi].t, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
      if (data.dayun && data.dayun.t && data.ri && data.ri.t) {
        var _s = getExactShen(data.dayun.t, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
    }
    else if (fieldType === '八字大运地支十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) {
          var _s = getDiShen(_baziPillars[_bi].d, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
      if (data.dayun && data.dayun.d && data.ri && data.ri.t) {
        var _s = getDiShen(data.dayun.d, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
    }
    else if (fieldType === '八字大运流年天干十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) sourceValues.push(getExactShen(_baziPillars[_bi].t, data.ri.t));
      }
      if (data.dayun && data.dayun.t && data.ri && data.ri.t) sourceValues.push(getExactShen(data.dayun.t, data.ri.t));
      if (data.liunian && data.liunian.t && data.ri && data.ri.t) sourceValues.push(getExactShen(data.liunian.t, data.ri.t));
    }
    else if (fieldType === '八字大运流年地支十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) sourceValues.push(getDiShen(_baziPillars[_bi].d, data.ri.t));
      }
      if (data.dayun && data.dayun.d && data.ri && data.ri.t) sourceValues.push(getDiShen(data.dayun.d, data.ri.t));
      if (data.liunian && data.liunian.d && data.ri && data.ri.t) sourceValues.push(getDiShen(data.liunian.d, data.ri.t));
    }
    else if (fieldType === '八字大运流年流月天干十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) sourceValues.push(getExactShen(_baziPillars[_bi].t, data.ri.t));
      }
      if (data.dayun && data.dayun.t && data.ri && data.ri.t) sourceValues.push(getExactShen(data.dayun.t, data.ri.t));
      if (data.liunian && data.liunian.t && data.ri && data.ri.t) sourceValues.push(getExactShen(data.liunian.t, data.ri.t));
      if (data.liuyue && data.liuyue.t && data.ri && data.ri.t) sourceValues.push(getExactShen(data.liuyue.t, data.ri.t));
    }
    else if (fieldType === '八字大运流年流月地支十神') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) sourceValues.push(getDiShen(_baziPillars[_bi].d, data.ri.t));
      }
      if (data.dayun && data.dayun.d && data.ri && data.ri.t) sourceValues.push(getDiShen(data.dayun.d, data.ri.t));
      if (data.liunian && data.liunian.d && data.ri && data.ri.t) sourceValues.push(getDiShen(data.liunian.d, data.ri.t));
      if (data.liuyue && data.liuyue.d && data.ri && data.ri.t) sourceValues.push(getDiShen(data.liuyue.d, data.ri.t));
    }
    else if (fieldType === '八字大运流年天干十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) {
          var _s = getExactShen(_baziPillars[_bi].t, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
      if (data.dayun && data.dayun.t && data.ri && data.ri.t) {
        var _s = getExactShen(data.dayun.t, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
      if (data.liunian && data.liunian.t && data.ri && data.ri.t) {
        var _s = getExactShen(data.liunian.t, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
    }
    else if (fieldType === '八字大运流年地支十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) {
          var _s = getDiShen(_baziPillars[_bi].d, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
      if (data.dayun && data.dayun.d && data.ri && data.ri.t) {
        var _s = getDiShen(data.dayun.d, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
      if (data.liunian && data.liunian.d && data.ri && data.ri.t) {
        var _s = getDiShen(data.liunian.d, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
    }
    else if (fieldType === '八字大运流年流月天干十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].t && data.ri && data.ri.t) {
          var _s = getExactShen(_baziPillars[_bi].t, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
      if (data.dayun && data.dayun.t && data.ri && data.ri.t) {
        var _s = getExactShen(data.dayun.t, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
      if (data.liunian && data.liunian.t && data.ri && data.ri.t) {
        var _s = getExactShen(data.liunian.t, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
      if (data.liuyue && data.liuyue.t && data.ri && data.ri.t) {
        var _s = getExactShen(data.liuyue.t, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
    }
    else if (fieldType === '八字大运流年流月地支十神组') {
      for (var _bi = 0; _bi < _baziPillars.length; _bi++) {
        if (_baziPillars[_bi] && _baziPillars[_bi].d && data.ri && data.ri.t) {
          var _s = getDiShen(_baziPillars[_bi].d, data.ri.t);
          sourceValues.push(SHEN_TO_GROUP[_s] || '');
        }
      }
      if (data.dayun && data.dayun.d && data.ri && data.ri.t) {
        var _s = getDiShen(data.dayun.d, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
      if (data.liunian && data.liunian.d && data.ri && data.ri.t) {
        var _s = getDiShen(data.liunian.d, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
      if (data.liuyue && data.liuyue.d && data.ri && data.ri.t) {
        var _s = getDiShen(data.liuyue.d, data.ri.t);
        sourceValues.push(SHEN_TO_GROUP[_s] || '');
      }
    }

    else if (['年干','月干','日干','时干','大运干','流年干','流月干'].indexOf(fieldType) >= 0) {
      var _map = {年干:'nian',月干:'yue',日干:'ri',时干:'shi',大运干:'dayun',流年干:'liunian',流月干:'liuyue'};
      var _k = _map[fieldType];
      if (data[_k] && data[_k].t) sourceValues.push(data[_k].t);
    }
    else if (['年支','月支','日支','时支','大运支','流年支','流月支'].indexOf(fieldType) >= 0) {
      var _map2 = {年支:'nian',月支:'yue',日支:'ri',时支:'shi',大运支:'dayun',流年支:'liunian',流月支:'liuyue'};
      var _k2 = _map2[fieldType];
      if (data[_k2] && data[_k2].d) sourceValues.push(data[_k2].d);
    }

    var _normalizeGroupVal = function(v) { return v === '财' ? '财星' : v === '印' ? '印星' : v; };
    sourceValues = sourceValues.map(_normalizeGroupVal);

    if (op === 'in') {
      res = true;
      for (var _ti = 0; _ti < targetValues.length; _ti++) {
        if (sourceValues.indexOf(_normalizeGroupVal(targetValues[_ti])) < 0) { res = false; break; }
      }
    } else if (op === 'nin') {
      res = true;
      for (var _ti = 0; _ti < targetValues.length; _ti++) {
        if (sourceValues.indexOf(_normalizeGroupVal(targetValues[_ti])) >= 0) { res = false; break; }
      }
    }
    actual = sourceValues.join(',');
  }

  // ---- 性别 ----
  else if (field === '性别') {
    actual = data.gender || '';
    if (op === 'eq') res = actual === val;
    else if (op === 'ne') res = actual !== val;
  }

  // ---- 存在大运/存在流年/存在流月 ----
  else if (field === '存在大运' || field === '存在流年' || field === '存在流月') {
    var _key = field === '存在大运' ? 'dayun' : field === '存在流年' ? 'liunian' : 'liuyue';
    var hasData = !!(data[_key] && data[_key].t);
    var valIsYes = val === '是';
    if (op === 'eq') res = hasData === valIsYes;
    else if (op === 'ne') res = hasData !== valIsYes;
    actual = hasData ? '是' : '否';
  }

  // ---- 触发范围 ----
  else if (field === '触发范围') {
    var _hasDayun = !!(data.dayun && data.dayun.t);
    var _hasLiunian = !!(data.liunian && data.liunian.t);
    var _hasLiuyue = !!(data.liuyue && data.liuyue.t);
    var scope = !_hasDayun ? '仅原局' : !_hasLiunian ? '原局+大运' : !_hasLiuyue ? '原局+大运+流年' : '原局+大运+流年+流月';
    actual = scope;
    if (op === 'eq') res = actual === val;
    else if (op === 'ne') res = actual !== val;
  }

  // ---- 五行数量对比 ----
  else if (field.indexOf('五行数量对比-') === 0) {
    var _name1 = field.replace('五行数量对比-', '');
    var _cnt1 = countWuXing(data, _name1, 'all');
    var _cnt2;
    
    if (val.indexOf('五行数量对比-') === 0) {
      var _name2 = val.replace('五行数量对比-', '');
      _cnt2 = countWuXing(data, _name2, 'all');
    } else if (WU_LIST.indexOf(val) >= 0) {
      _cnt2 = countWuXing(data, val, 'all');
    } else {
      _cnt2 = countWuXing(data, val, 'all');
    }
    
    if (op === 'eq') res = _cnt1 == _cnt2;
    else if (op === 'ge') res = _cnt1 >= _cnt2;
    else if (op === 'gt') res = _cnt1 > _cnt2;
    else if (op === 'le') res = _cnt1 <= _cnt2;
    else if (op === 'lt') res = _cnt1 < _cnt2;
    actual = _name1 + '=' + _cnt1 + ', ' + val + '=' + _cnt2;
  }

  // ---- 十神数量对比 ----
  else if (field.indexOf('十神数量对比-') === 0) {
    var _name2 = field.replace('十神数量对比-', '');
    var _cntA = 0, _cntB = 0;
    var _rg = data.ri && data.ri.t;
    
    if (_rg) {
      var _isGroup2 = ['比劫','食伤','财星','官杀','印星'].indexOf(_name2) >= 0;
      var _pillars6 = ['nian','yue','ri','shi'];
      for (var _pi6 = 0; _pi6 < _pillars6.length; _pi6++) {
        var _p6 = data[_pillars6[_pi6]];
        if (_p6 && _p6.t) {
          var _sA = getExactShen(_p6.t, _rg);
          if (_isGroup2 ? (SHEN_TO_GROUP[_sA] === _name2) : (_sA === _name2)) _cntA++;
        }
        if (_p6 && _p6.d) {
          var _sA2 = getDiShen(_p6.d, _rg);
          if (_isGroup2 ? (SHEN_TO_GROUP[_sA2] === _name2) : (_sA2 === _name2)) _cntA++;
        }
      }
      
      var _isGroupVal = ['比劫','食伤','财星','官杀','印星'].indexOf(val) >= 0;
      for (var _pi6b = 0; _pi6b < _pillars6.length; _pi6b++) {
        var _p6b = data[_pillars6[_pi6b]];
        if (_p6b && _p6b.t) {
          var _sB = getExactShen(_p6b.t, _rg);
          if (_isGroupVal ? (SHEN_TO_GROUP[_sB] === val) : (_sB === val)) _cntB++;
        }
        if (_p6b && _p6b.d) {
          var _sB2 = getDiShen(_p6b.d, _rg);
          if (_isGroupVal ? (SHEN_TO_GROUP[_sB2] === val) : (_sB2 === val)) _cntB++;
        }
      }
    }
    
    if (op === 'eq') res = _cntA == _cntB;
    else if (op === 'ge') res = _cntA >= _cntB;
    else if (op === 'gt') res = _cntA > _cntB;
    else if (op === 'le') res = _cntA <= _cntB;
    else if (op === 'lt') res = _cntA < _cntB;
    actual = _name2 + '=' + _cntA + ', ' + val + '=' + _cntB;
  }

  // ---- 干支数量 ----
  else if (field.indexOf('干支数量-') === 0) {
    var _gzName = field.replace('干支数量-', '');
    var _gzCnt = 0;
    var _gzPillars = ['nian','yue','ri','shi','dayun','liunian','liuyue'];
    for (var _gzi = 0; _gzi < _gzPillars.length; _gzi++) {
      var _k = data[_gzPillars[_gzi]];
      if (_k && _k.t === _gzName) _gzCnt++;
      if (_k && _k.d === _gzName) _gzCnt++;
    }
    actual = String(_gzCnt);
    if (op === 'eq') res = _gzCnt == Number(val);
    else if (op === 'ge') res = _gzCnt >= Number(val);
    else if (op === 'gt') res = _gzCnt > Number(val);
    else if (op === 'le') res = _gzCnt <= Number(val);
    else if (op === 'lt') res = _gzCnt < Number(val);
  }

  // ---- 年龄 ----
  else if (field === '年龄') {
    if (data.effectiveAge == null) {
      res = false;
    } else {
      var _age = data.effectiveAge, _ageVal = Number(val);
      if (op === 'ge') res = _age >= _ageVal;
      else if (op === 'gt') res = _age > _ageVal;
      else if (op === 'le') res = _age <= _ageVal;
      else if (op === 'lt') res = _age < _ageVal;
    }
    actual = String(data.effectiveAge != null ? data.effectiveAge : 'null');
  }

  return res;
}

// ===================== 规则匹配 =====================

function matchRule(data, conditions) {
  if (!conditions) return true;

  // 构建初始上下文：传递断语规则的默认取值维度（最高优先级）
  var initContext = {};
  if (conditions.defaultQuZhi) {
    initContext.ruleDefaultQuZhi = conditions.defaultQuZhi;
  }
  // 传递断语规则的默认映射规则（最高优先级）
  if (conditions.defaultMapping) {
    initContext.ruleDefaultMapping = conditions.defaultMapping;
  }

  if (conditions.logic && conditions.children && !Array.isArray(conditions)) {
    return evaluateConditionNode(data, conditions, initContext);
  }

  if (Array.isArray(conditions)) {
    if (conditions.length === 0) return true;
    for (var i = 0; i < conditions.length; i++) {
      if (!evaluateConditionNode(data, conditions[i], initContext)) return false;
    }
    return true;
  }

  return true;
}

// ===================== Supabase 数据获取 =====================

function httpFetch(url, options) {
  var urlObj = new URL(url);
  var mod = urlObj.protocol === 'https:' ? https : http;

  return new Promise(function(resolve, reject) {
    var opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 10000
    };

    var req = mod.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        var body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          status: res.statusCode,
          body: body,
          headers: res.headers
        });
      });
    });

    req.on('error', function(e) { reject(e); });
    req.on('timeout', function() { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

var SUPABASE_CONFIG = {
  url: '',
  anonKey: '',
  tableName: 'duanyu',
  macrosTableName: 'condition_macros',
  fieldConfigTableName: 'field_config'
};

var _fieldConfigCache = null;

function fetchFieldConfigFromSupabase() {
  if (_fieldConfigCache) {
    return Promise.resolve(_fieldConfigCache);
  }
  
  var url = SUPABASE_CONFIG.url + '/rest/v1/' + SUPABASE_CONFIG.fieldConfigTableName + '?select=field_name,field_value,template_type,field_group';
  
  return httpFetch(url, {
    headers: {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey,
      'Accept': 'application/json'
    },
    timeout: 10000
  }).then(function(response) {
    if (!response || !response.body) return [];
    
    var parsedBody;
    try {
      parsedBody = JSON.parse(response.body);
    } catch (parseErr) {
      return [];
    }
    
    if (!Array.isArray(parsedBody)) return [];
    
    _fieldConfigCache = parsedBody;
    return parsedBody;
  }).catch(function(e) {
    return [];
  });
}

function fetchRulesFromSupabase() {
  var url = SUPABASE_CONFIG.url + '/rest/v1/' + SUPABASE_CONFIG.tableName + '?select=id,category,duanyu_text,conditions,permission_level,user_id,owner_id,group_key,priority';

  return httpFetch(url, {
    headers: {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey,
      'Accept': 'application/json'
    },
    timeout: 10000
  }).then(function(response) {
    if (!response || !response.body) {
      console.error('Supabase 返回空响应, status:', response && response.status);
      return null;
    }

    // 检查 HTTP 状态码
    if (response.status >= 400) {
      console.error('Supabase HTTP 错误:', response.status, response.body);
      return null;
    }

    var parsedBody;
    try {
      parsedBody = JSON.parse(response.body);
    } catch (parseErr) {
      console.error('Supabase 返回非 JSON:', response.status, response.body);
      return null;
    }

    if (!Array.isArray(parsedBody)) {
      console.error('Supabase 返回非数组, status:', response.status, 'body:', JSON.stringify(parsedBody));
      return null;
    }

    var validRules = parsedBody.filter(function(r) {
      return r && r.category && r.duanyu_text && r.conditions;
    });

    return validRules.length > 0 ? validRules : null;
  }).catch(function(e) {
    console.error('fetchRulesFromSupabase 异常:', e.message);
    return null;
  });
}

function fetchMacrosFromSupabase() {
  var url = SUPABASE_CONFIG.url + '/rest/v1/' + SUPABASE_CONFIG.macrosTableName + '?select=id,name,conditions';

  return httpFetch(url, {
    headers: {
      'apikey': SUPABASE_CONFIG.anonKey,
      'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey,
      'Accept': 'application/json'
    },
    timeout: 10000
  }).then(function(response) {
    if (!response || !response.body) return [];

    var parsedBody;
    try {
      parsedBody = JSON.parse(response.body);
    } catch (parseErr) {
      return [];
    }

    if (!Array.isArray(parsedBody)) return [];

    var validMacros = parsedBody.filter(function(m) {
      return m && m.id && m.conditions;
    });

    return validMacros;
  }).catch(function(e) {
    return [];
  });
}

/** 根据用户权限过滤断语规则 */
function filterRulesByAccess(rules, currentUserId, isAdmin) {
  if (!rules) return rules;

  // 管理员查看所有规则（包括私有规则）
  if (isAdmin) return rules;

  return rules.filter(function(r) {
    var level = r.permission_level;

    if (level === null || level === undefined) return true;
    if (level >= 1) return true;

    var ownerId = r.user_id || r.owner_id;
    if (currentUserId && ownerId && ownerId === currentUserId) return true;

    return false;
  });
}

// ===================== 主匹配函数 =====================

function matchDuanyu(baziData, dayunItem, liunianItem, liuyueItem, gender, rules, birthYear, macros, macroIdMapping, mappingRules, biDebug) {
  var md = {
    nian: { t: baziData.bazi.nian.gan, d: baziData.bazi.nian.zhi },
    yue:  { t: baziData.bazi.yue.gan, d: baziData.bazi.yue.zhi },
    ri:   { t: baziData.bazi.ri.gan,   d: baziData.bazi.ri.zhi },
    shi:  { t: baziData.bazi.shi.gan,  d: baziData.bazi.shi.zhi },
    dayun: null, liunian: null, liuyue: null, gender: gender,
    birthYear: birthYear || null,
    macros: macros || [],
    rules: rules || [],
    idMapping: macroIdMapping ? { macros: macroIdMapping } : null,
    mappingRules: mappingRules || null,
    biDebug: biDebug ? [] : null
  };
  if (dayunItem) md.dayun = { t: dayunItem.gan, d: dayunItem.zhi, ganZhi: dayunItem.ganZhi };
  if (liunianItem) md.liunian = { t: liunianItem.gan, d: liunianItem.zhi, ganZhi: liunianItem.ganZhi };
  if (liuyueItem) md.liuyue = { t: liuyueItem.gan, d: liuyueItem.zhi };

  // 计算有效年龄
  if (liunianItem && birthYear) {
    md.effectiveAge = liunianItem.year - birthYear + 1;
  } else if (dayunItem && birthYear) {
    md.effectiveAge = dayunItem.startAge + (dayunItem.endYear - dayunItem.startYear);
  }

  var result = [];
  if (!rules) return result;
  for (var i = 0; i < rules.length; i++) {
    if (matchRule(md, rules[i].conditions)) {
      result.push(rules[i]);
    }
  }

  // 按 group_key 分组去重：同组内只保留 priority 最高的规则
  var groups = {};
  var ungrouped = [];
  for (var ri = 0; ri < result.length; ri++) {
    var r = result[ri];
    var gk = r.group_key || '';
    if (gk) {
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(r);
    } else {
      ungrouped.push(r);
    }
  }
  var deduped = [];
  for (var gk in groups) {
    var members = groups[gk];
    var maxP = 0;
    for (var mi = 0; mi < members.length; mi++) {
      if ((members[mi].priority || 0) > maxP) maxP = members[mi].priority || 0;
    }
    for (var mi = 0; mi < members.length; mi++) {
      if ((members[mi].priority || 0) >= maxP) deduped.push(members[mi]);
    }
  }
  result = ungrouped.concat(deduped);

  // 调试信息随结果返回（仅 body.debug=true 时启用）
  result._biDebug = md.biDebug;

  return result;
}

// ===================== Vercel Handler =====================

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    // 健康检查 / 调试端点
    return res.json({
      success: true,
      name: '断语匹配 API',
      version: '1.0',
      config: {
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSupabaseKey: !!process.env.SUPABASE_KEY,
        hasSupabaseServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
        supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 20) + '...' : '未设置',
        keyLength: (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '').length + ' chars',
        usedKey: process.env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : (process.env.SUPABASE_KEY ? 'SUPABASE_KEY' : '未设置')
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: '仅支持 POST 请求' });
  }

  // 初始化 Supabase 配置
  var supabaseUrl = process.env.SUPABASE_URL || '';
  // 优先使用 SERVICE_KEY（绕过 RLS），兼容旧配置 SUPABASE_KEY
  var supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: '服务端配置缺失：SUPABASE_URL 或 SUPABASE_SERVICE_KEY 未设置'
    });
  }

  SUPABASE_CONFIG.url = supabaseUrl.replace(/\/+$/, ''); // 去掉末尾斜杠
  SUPABASE_CONFIG.anonKey = supabaseKey;

  try {
    var body = req.body;
    if (!body || !body.bazi) {
      return res.status(400).json({ success: false, error: '缺少必要参数：bazi 数据' });
    }

    var baziData = {
      bazi: body.bazi,
      gender: body.gender || '男',
      dayun: body.dayun || [],
      liunian: body.liunian || []
    };
    var birthYear = body.birthYear || null;
    var currentUserId = body.currentUserId || null;
    var isAdminUser = body.isAdmin || false;

    // ---- 从 Supabase 获取断语规则、条件宏和字段配置 ----
    var results = await Promise.all([fetchRulesFromSupabase(), fetchMacrosFromSupabase(), fetchFieldConfigFromSupabase()]);
    var rules = results[0];
    var macros = results[1];
    _fieldConfigCache = results[2];

    // 按用户权限过滤
    if (rules && rules.length > 0) {
      rules = filterRulesByAccess(rules, currentUserId, isAdminUser === true);
    }

    // 按用户本地开关状态过滤：关闭的断语（disabledRuleIds）与关闭的分类（disabledCategories）不参与匹配
    if (rules && rules.length > 0) {
      if (Array.isArray(body.disabledRuleIds) && body.disabledRuleIds.length > 0) {
        rules = rules.filter(function(r) { return body.disabledRuleIds.indexOf(String(r.id)) === -1; });
      }
      if (Array.isArray(body.disabledCategories) && body.disabledCategories.length > 0) {
        rules = rules.filter(function(r) { return body.disabledCategories.indexOf(r.category) === -1; });
      }
    }

    if (!rules || rules.length === 0) {
      var failReason = rules === null ? 'Supabase 返回空或请求失败' : 'Supabase 中没有有效的断语规则';
      return res.json({
        success: false,
        error: '断语规则服务暂不可用，请稍后再试',
        detail: failReason,
        supabaseUrl: process.env.SUPABASE_URL ? '已设置' : '未设置',
        supabaseKey: process.env.SUPABASE_KEY ? '已设置' : '未设置',
        data: null
      });
    }

    // 单次匹配：前端发送当前选中的完整状态，API 只调用一次 matchDuanyu()，条件自动过滤
    var currentDayun = body.currentDayun || null;
    var currentLiunian = body.currentLiunian || null;
    var currentLiuyue = body.currentLiuyue || null;
    var biDebug = !!(body.debug === true || body.debug === 'true' || body.debug === 1 || body.debug === '1');
    
    var matched = matchDuanyu(baziData, currentDayun, currentLiunian, currentLiuyue, baziData.gender, rules, birthYear, macros, body.macroIdMapping || null, body.mappingRules || null, biDebug);
    var result = matched.map(function(r) {
      return {
        duanyu: r.duanyu_text,
        category: r.category,
        group_key: r.group_key || '',
        priority: r.priority || 0,
        rule: { category: r.category, duanyu: r.duanyu_text, group_key: r.group_key || '', priority: r.priority || 0 }
      };
    });

    var respData = { duanyu: result };
    if (biDebug) respData.debug = matched._biDebug || [];

    return res.json({
      success: true,
      data: respData
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      error: '断语匹配服务异常: ' + e.message
    });
  }
};
