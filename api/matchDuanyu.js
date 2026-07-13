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
function evaluateConditionNode(data, condNode) {
  // macroRef 节点：查找宏定义并递归评估
  if (condNode && condNode.macroRef) {
    var macroId = String(condNode.macroRef);
    var macros = data && data.macros;
    if (macros && macros.length > 0) {
      for (var mi = 0; mi < macros.length; mi++) {
        var m = macros[mi];
        if (m && m.conditions && (String(m.id) === macroId || String(m.cloudId) === macroId)) {
          return evaluateConditionNode(data, m.conditions);
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
          return evaluateConditionNode(data, rr.conditions);
        }
      }
    }
    return false;
  }

  // 叶子节点：包含 op, val, field
  if (condNode.op && condNode.field !== undefined) {
    return evaluateLeafCondition(data, condNode);
  }

  // 分支节点：包含 logic, children
  if (condNode.logic && condNode.children && condNode.children.length > 0) {
    var children = condNode.children;
    if (condNode.logic === 'or') {
      for (var i = 0; i < children.length; i++) {
        if (evaluateConditionNode(data, children[i])) return true;
      }
      return false;
    } else {
      for (var i = 0; i < children.length; i++) {
        if (!evaluateConditionNode(data, children[i])) return false;
      }
      return true;
    }
  }

  return true;
}

/**
 * 评估单个叶子条件
 */
function evaluateLeafCondition(data, cond) {
  var field = cond.field;
  var op = cond.op;
  var val = cond.val;

  var actual = '';
  var res = false;

  // ---- 天干/地支直接对比 ----
  if (['年干','月干','日干','时干','大运干','流年干','流月干'].indexOf(field) >= 0) {
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

  // ---- 五行数量（统一处理所有前缀变体） ----
  else if (field.indexOf('五行数量-') >= 0) {
    var name = field.substring(field.lastIndexOf('-') + 1);
    var hasDayun = field.indexOf('大运') >= 0;
    var hasLiunian = field.indexOf('流年') >= 0;
    var onlyTiangan = field.indexOf('天干') >= 0;
    var onlyDizhi = field.indexOf('地支') >= 0;
    var cnt = 0;
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

  // ---- 十神数量（统一处理所有前缀变体） ----
  else if (field.indexOf('十神数量-') >= 0) {
    var name = field.substring(field.lastIndexOf('-') + 1);
    var hasDayun = field.indexOf('大运') >= 0;
    var hasLiunian = field.indexOf('流年') >= 0;
    var onlyTiangan = field.indexOf('天干') >= 0;
    var onlyDizhi = field.indexOf('地支') >= 0;
    var isGroup = ['比劫','食伤','财星','官杀','印星'].indexOf(name) >= 0;

    if (!data.ri || !data.ri.t) { res = false; } else {
      var cnt = 0;
      var rg = data.ri.t;
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
    var _cnt1 = 0, _cnt2 = 0;
    var _pillars5 = ['nian','yue','ri','shi'];
    for (var _pi5 = 0; _pi5 < _pillars5.length; _pi5++) {
      var _p5 = data[_pillars5[_pi5]];
      if (_p5 && _p5.t && WU_XING[_p5.t] === _name1) _cnt1++;
      if (_p5 && _p5.d && WU_XING[_p5.d] === _name1) _cnt1++;
      if (_p5 && _p5.t && WU_XING[_p5.t] === val) _cnt2++;
      if (_p5 && _p5.d && WU_XING[_p5.d] === val) _cnt2++;
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
      var _pillars6 = ['nian','yue','ri','shi'];
      for (var _pi6 = 0; _pi6 < _pillars6.length; _pi6++) {
        var _p6 = data[_pillars6[_pi6]];
        if (_p6 && _p6.t) {
          var _sA = getExactShen(_p6.t, _rg); var _sB = getExactShen(_p6.t, _rg);
          if (SHEN_TO_GROUP[_sA] === _name2 || _sA === _name2) _cntA++;
          if (SHEN_TO_GROUP[_sB] === val || _sB === val) _cntB++;
        }
        if (_p6 && _p6.d) {
          var _sA2 = getDiShen(_p6.d, _rg); var _sB2 = getDiShen(_p6.d, _rg);
          if (SHEN_TO_GROUP[_sA2] === _name2 || _sA2 === _name2) _cntA++;
          if (SHEN_TO_GROUP[_sB2] === val || _sB2 === val) _cntB++;
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

  if (conditions.logic && conditions.children && !Array.isArray(conditions)) {
    return evaluateConditionNode(data, conditions);
  }

  if (Array.isArray(conditions)) {
    if (conditions.length === 0) return true;
    for (var i = 0; i < conditions.length; i++) {
      if (!evaluateConditionNode(data, conditions[i])) return false;
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
  macrosTableName: 'condition_macros'
};

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

function matchDuanyu(baziData, dayunItem, liunianItem, gender, rules, birthYear, macros) {
  var md = {
    nian: { t: baziData.bazi.nian.gan, d: baziData.bazi.nian.zhi },
    yue:  { t: baziData.bazi.yue.gan, d: baziData.bazi.yue.zhi },
    ri:   { t: baziData.bazi.ri.gan,   d: baziData.bazi.ri.zhi },
    shi:  { t: baziData.bazi.shi.gan,  d: baziData.bazi.shi.zhi },
    dayun: null, liunian: null, gender: gender,
    birthYear: birthYear || null,
    macros: macros || [],
    rules: rules || []
  };
  if (dayunItem) md.dayun = { t: dayunItem.gan, d: dayunItem.zhi, ganZhi: dayunItem.ganZhi };
  if (liunianItem) md.liunian = { t: liunianItem.gan, d: liunianItem.zhi, ganZhi: liunianItem.ganZhi };

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
        keyLength: (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || '').length + ' chars',
        usedKey: process.env.SUPABASE_KEY ? 'SUPABASE_KEY' : (process.env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : '未设置')
      }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: '仅支持 POST 请求' });
  }

  // 初始化 Supabase 配置
  var supabaseUrl = process.env.SUPABASE_URL || '';
  var supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: '服务端配置缺失：SUPABASE_URL 或 SUPABASE_KEY 未设置'
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

    // ---- 从 Supabase 获取断语规则和条件宏 ----
    var results = await Promise.all([fetchRulesFromSupabase(), fetchMacrosFromSupabase()]);
    var rules = results[0];
    var macros = results[1];

    // 按用户权限过滤
    if (rules && rules.length > 0) {
      rules = filterRulesByAccess(rules, currentUserId, isAdminUser === true);
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

    // 1. 原局断语
    var baseMatched = matchDuanyu(baziData, null, null, baziData.gender, rules, birthYear, macros);
    var baseResult = baseMatched.map(function(r) {
      return {
        duanyu: r.duanyu_text,
        category: r.category,
        group_key: r.group_key || '',
        priority: r.priority || 0,
        rule: { category: r.category, duanyu: r.duanyu_text, group_key: r.group_key || '', priority: r.priority || 0 }
      };
    });

    // 2. 大运断语
    var dayunResults = [];
    if (baziData.dayun && baziData.dayun.length > 0) {
      for (var d = 0; d < baziData.dayun.length; d++) {
        var dy = baziData.dayun[d];
        if (!dy.ganZhi) continue;
        var dyMatched = matchDuanyu(baziData, dy, null, baziData.gender, rules, birthYear, macros);
        dayunResults.push({
          index: dy.index,
          ganZhi: dy.ganZhi,
          startAge: dy.startAge,
          startYear: dy.startYear,
          endYear: dy.endYear,
          duanyu: dyMatched.map(function(r) {
            return { duanyu: r.duanyu_text, category: r.category, group_key: r.group_key || '', priority: r.priority || 0, rule: { category: r.category, duanyu: r.duanyu_text, group_key: r.group_key || '', priority: r.priority || 0 } };
          })
        });
      }
    }

    // 3. 流年断语
    var liunianResults = [];
    if (baziData.liunian && baziData.liunian.length > 0) {
      for (var li = 0; li < baziData.liunian.length; li++) {
        var ln = baziData.liunian[li];
        var dyForLn = null;
        if (baziData.dayun && baziData.dayun.length > 0) {
          for (var di = 0; di < baziData.dayun.length; di++) {
            if (baziData.dayun[di].index === ln.dayunIndex) {
              dyForLn = baziData.dayun[di];
              break;
            }
          }
        }
        var lnMatched = matchDuanyu(baziData, dyForLn, ln, baziData.gender, rules, birthYear, macros);
        liunianResults.push({
          year: ln.year,
          ganZhi: ln.ganZhi,
          dayunIndex: ln.dayunIndex,
          isCurrentYear: ln.isCurrentYear,
          duanyu: lnMatched.map(function(r) {
            return { duanyu: r.duanyu_text, category: r.category, group_key: r.group_key || '', priority: r.priority || 0, rule: { category: r.category, duanyu: r.duanyu_text, group_key: r.group_key || '', priority: r.priority || 0 } };
          })
        });
      }
    }

    return res.json({
      success: true,
      data: {
        duanyu: {
          base: baseResult,
          dayun: dayunResults,
          liunian: liunianResults
        }
      },
      _debug: {
        totalRules: rules ? rules.length : 0,
        totalMacros: macros ? macros.length : 0,
        baseMatchCount: baseResult.length,
        dayunMatchCount: dayunResults.reduce(function(s, d) { return s + d.duanyu.length; }, 0),
        liunianMatchCount: liunianResults.reduce(function(s, d) { return s + d.duanyu.length; }, 0)
      }
    });

  } catch (e) {
    return res.status(500).json({
      success: false,
      error: '断语匹配服务异常: ' + e.message
    });
  }
};
