/** ============================================================
 *  wps_bazi_api_mode.js - WPS AirScript 八字断语匹配（API 模式）
 *  
 *  本脚本通过调用云端 API 进行排盘和断语匹配，
 *  不包含排盘库和规则数据，代码体积小。
 *  
 *  依赖：已部署的云函数 API（在 API_URL 中配置）
 *  
 *  使用方法：
 *    1. 将本脚本复制到 WPS AirScript 编辑器
 *    2. 修改 CONFIG.API_URL 为你的云函数地址
 *    3. 运行脚本
 *  
 *  ============================================================
 *  ★ 修改 API 地址（重要）
 *  ============================================================
 *  找到下方 CONFIG 中的 API_URL，替换为你的云函数地址。
 *  如果切换了云函数，只需修改这一处即可。
 * ============================================================ */

// ============================================================
// ===================== 配置区域 ==============================
// ============================================================

var CONFIG = {
  SHEET_NAME: '工作表1',

  // === 云函数 API 地址（必填）===
  API_URL: 'https://1254456257-fkggh2mgvo.ap-shanghai.tencentscf.com/api/bazi',

  // 列序号（从 1 开始）
  COL: {
    BIRTH_DATE_TIME: 1,   // A 列：出生日期+时间
    GENDER: 2,            // B 列：性别
    CUSTOM: {             // C~E 列：3 列自定义列
      START: 3,
      COUNT: 3
    },
    BAZI_DISP: 6,         // F 列：八字干支
    BASE_DUANYU: 7,       // G 列：原局断语
    GROUP_START: 8,       // H 列起始（分组列：每组 11 列 = 1 大运 + 10 流年）
    DAYUN_COUNT: 10,      // 10 个大运
    LIUNIAN_PER_DAYUN: 10, // 每大运 10 个流年
    GROUP_WIDTH: 11       // 每组列数
  },

  // 运行模式
  MODE: 'all',  // 'all'=全量 | 'selected'=只处理选中行 | 'incremental'=跳过已处理行 | 'incremental_selected'=选中行中增量
  MARK_COL: 5,    // 增量模式的标记列（E 列）
  MARK_TEXT: '✓', // 自定义标记文字

  // 每行处理间隔（毫秒）
  REQUEST_INTERVAL_MS: 200
};

// ============================================================
// ===================== 工具函数 ==============================
// ============================================================

// ---- 五行映射（仅用于八字显示）----
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

function getExactShen(gan, riGan) {
  if (!gan || !riGan) return '-';
  var gx = WU_XING[gan], rx = WU_XING[riGan];
  var gy = GAN_YINYANG[gan], ry = GAN_YINYANG[riGan];
  if (gx === rx) return gy === ry ? '比肩' : '劫财';
  function sheng(x, y) { return (x==='木'&&y==='火')||(x==='火'&&y==='土')||(x==='土'&&y==='金')||(x==='金'&&y==='水')||(x==='水'&&y==='木'); }
  if (sheng(gx, rx)) return gy !== ry ? '正印' : '偏印';
  if (sheng(rx, gx)) return gy === ry ? '食神' : '伤官';
  function ke(x, y) { return (x==='木'&&y==='土')||(x==='土'&&y==='水')||(x==='水'&&y==='火')||(x==='火'&&y==='金')||(x==='金'&&y==='木'); }
  if (ke(gx, rx)) return gy !== ry ? '正官' : '七杀';
  if (ke(rx, gx)) return gy !== ry ? '正财' : '偏财';
  return '-';
}

function getDiShen(d, rg) {
  return d ? getExactShen(DI_ZHU_MAIN[d], rg) : '-';
}

/** 解析日期时间字符串 */
function parseDateTime(str) {
  if (!str) return null;
  str = str.trim();
  var m1 = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m1) return { date: m1[1] + pad2(m1[2]) + pad2(m1[3]), time: pad2(m1[4]) + pad2(m1[5]) };
  var m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m2) return { date: m2[1] + pad2(m2[2]) + pad2(m2[3]), time: pad2(m2[4]) + pad2(m2[5]) };
  var m3 = str.match(/^(\d{8})(?:\s+(\d{4}))?$/);
  if (m3) return { date: m3[1], time: m3[2] || '0000' };
  var m4 = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m4) return { date: m4[1] + m4[2] + m4[3], time: m4[4] + m4[5] };
  return null;
}

function pad2(n) { return ('0' + n).slice(-2); }

/** 去除 HTML 标签 */
function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}

/** 格式化断语列表（与本地版一致的显示格式） */
function formatDuanyuList(matchedList) {
  if (!matchedList || matchedList.length === 0) return '';
  var groups = {};
  for (var i = 0; i < matchedList.length; i++) {
    var item = matchedList[i];
    var cat = item.category || '未分类';
    if (!groups[cat]) groups[cat] = [];
    var text = String(item.duanyu || item.duanyu_text || '').replace(/<[^>]*>/g, '');
    if (text && groups[cat].indexOf(text) < 0) {
      groups[cat].push(text);
    }
  }
  var parts = [];
  for (var cat in groups) {
    parts.push(cat + ':\n' + groups[cat].join('\n'));
  }
  return parts.join('\n---\n');
}

/** 八字显示字符串（5 层纵向 + 柱间分隔） */
function baziDisplayStr(bd) {
  var b = bd.bazi;
  var rg = b.ri.gan;
  var pad = '  |   ';
  var sep = '\n';
  var l1 = '年柱' + pad + '月柱' + pad + '日柱' + pad + '时柱';
  var l2 = getExactShen(b.nian.gan, rg) + pad + getExactShen(b.yue.gan, rg) + pad + getExactShen(b.ri.gan, rg) + pad + getExactShen(b.shi.gan, rg);
  var l3 = b.nian.gan + WU_XING[b.nian.gan] + pad + b.yue.gan + WU_XING[b.yue.gan] + pad + b.ri.gan + WU_XING[b.ri.gan] + pad + b.shi.gan + WU_XING[b.shi.gan];
  var l4 = b.nian.zhi + WU_XING[b.nian.zhi] + pad + b.yue.zhi + WU_XING[b.yue.zhi] + pad + b.ri.zhi + WU_XING[b.ri.zhi] + pad + b.shi.zhi + WU_XING[b.shi.zhi];
  var l5 = getDiShen(b.nian.zhi, rg) + pad + getDiShen(b.yue.zhi, rg) + pad + getDiShen(b.ri.zhi, rg) + pad + getDiShen(b.shi.zhi, rg);
  return l1 + sep + l2 + sep + l3 + sep + l4 + sep + l5;
}

// ============================================================
// ===================== API 调用 =============================
// ============================================================

/**
 * 调用云函数 API 进行排盘+断语匹配
 * 使用 WPS AirScript 的 HTTP 对象（同步请求）
 *
 * 注意：使用前需要在脚本编辑器中添加【网络 API】服务：
 *   工具栏 → 服务 → 添加服务 → 网络 API → 确认
 *
 * @param {string} birthDate - YYYYMMDD
 * @param {string} birthTime - HHmm
 * @param {string} gender - '男' 或 '女'
 * @returns {object} API 返回的数据对象
 */
function callBaziApi(birthDate, birthTime, gender) {
  var url = CONFIG.API_URL;
  var body = JSON.stringify({
    birthDate: birthDate,
    birthTime: birthTime,
    gender: gender
  });

  var resp = HTTP.fetch(url, {
    method: 'POST',
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
    body: body
  });

  if (resp.status !== 200) {
    throw new Error('API 请求失败，状态码: ' + resp.status + '，响应: ' + resp.text());
  }

  var json = resp.json();
  if (!json || !json.success) {
    throw new Error('API 返回错误: ' + (json ? json.error : '响应为空'));
  }

  return json.data;
}

function sleep(ms) {
  var start = new Date().getTime();
  while (new Date().getTime() - start < ms);
}

// ============================================================
// ===================== 主流程 ==============================
// ============================================================

function main() {
  var processedCount = 0;
  var matchCount = 0;
  var errorCount = 0;
  var errors = [];

  // 获取工作表
  var sheet = null;
  try { sheet = ActiveWorkbook.Worksheets(CONFIG.SHEET_NAME); } catch (e) {}
  if (!sheet) { try { sheet = ActiveWorkbook.Worksheets.Item(CONFIG.SHEET_NAME); } catch (e) {} }
  if (!sheet) { sheet = ActiveWorkbook.ActiveSheet; }
  if (!sheet) { console.log('错误: 无法获取工作表'); return; }
  console.log('使用工作表: ' + (sheet.Name || CONFIG.SHEET_NAME));

  var usedRange = sheet.UsedRange;
  var maxRow = usedRange.Rows.Count;
  console.log('表格范围: ' + maxRow + ' 行（上限）');

  // 正向扫描找到最后一行有效数据（连续 10 行空白则认为后续无数据）
  var rowCount = 1;
  var emptyCount = 0;
  for (var r = 2; r <= maxRow; r++) {
    var chk1 = String(sheet.Cells(r, CONFIG.COL.BIRTH_DATE_TIME).Text || '').trim();
    var chk2 = String(sheet.Cells(r, CONFIG.COL.GENDER).Text || '').trim();
    if (chk1 || chk2) { rowCount = r; emptyCount = 0; }
    else { emptyCount++; if (emptyCount >= 10) break; }
  }
  console.log('实际数据末行: ' + rowCount + ' 行');

  if (rowCount < 2) { console.log('没有数据行（第 1 行为表头，数据从第 2 行开始）'); return; }

  // 模式检测
  var mode = (CONFIG.MODE || 'all').toLowerCase();
  var selectedRows = [];
  var isSelectedMode = mode === 'selected' || mode === 'incremental_selected';
  var isIncrementalMode = mode === 'incremental' || mode === 'incremental_selected';

  if (isSelectedMode) {
    try {
      var sel = Application.Selection;
      if (sel) {
        var selStart = sel.Row;
        var selCount = sel.Rows.Count;
        for (var si = 0; si < selCount; si++) selectedRows.push(selStart + si);
        console.log('运行模式: selected（选中 ' + selectedRows.length + ' 行）');
      }
    } catch (e) { isSelectedMode = false; }
  }

  if (isIncrementalMode) {
    console.log('运行模式: incremental（标记列: ' + CONFIG.MARK_COL + '，标记文字: ' + CONFIG.MARK_TEXT + '）');
  }

  // === 写入单行表头 ===
  var col = CONFIG.COL;
  sheet.Cells(1, col.BAZI_DISP).Value2 = '八字原局';
  sheet.Cells(1, col.BASE_DUANYU).Value2 = '原局断语';

  // 尝试用第一条数据计算大运数来写表头
  var headerDayunCount = 0;
  var hdt = String(sheet.Cells(2, col.BIRTH_DATE_TIME).Text || '').trim();
  var hg = String(sheet.Cells(2, col.GENDER).Text || '').trim();
  if (hdt && hg) {
    try {
      var hp = parseDateTime(hdt);
      if (hp) {
        var hData = callBaziApi(hp.date, hp.time, hg === '男' ? '男' : '女');
        if (hData && hData.dayun) {
          var hCount = 0;
          for (var hi = 0; hi < hData.dayun.length && hCount < col.DAYUN_COUNT; hi++) {
            if (hData.dayun[hi].ganZhi && hData.dayun[hi].ganZhi.length > 0) {
              var dayunCol = col.GROUP_START + hCount * col.GROUP_WIDTH;
              sheet.Cells(1, dayunCol).Value2 = '第' + (hCount + 1) + '步大运';
              for (var hli = 0; hli < col.LIUNIAN_PER_DAYUN; hli++) {
                var lnCol = col.GROUP_START + hCount * col.GROUP_WIDTH + 1 + hli;
                sheet.Cells(1, lnCol).Value2 = '第' + (hCount + 1) + '步大运第' + (hli + 1) + '年';
              }
              hCount++;
            }
          }
          headerDayunCount = hCount;
        }
      }
    } catch (e) { /* 表头获取失败则用兜底 */ }
  }
  if (headerDayunCount === 0) {
    for (var hd = 0; hd < col.DAYUN_COUNT; hd++) {
      sheet.Cells(1, col.GROUP_START + hd * col.GROUP_WIDTH).Value2 = '第' + (hd + 1) + '步大运';
      for (var hli = 0; hli < col.LIUNIAN_PER_DAYUN; hli++) {
        sheet.Cells(1, col.GROUP_START + hd * col.GROUP_WIDTH + 1 + hli).Value2 = '第' + (hd + 1) + '步大运第' + (hli + 1) + '年';
      }
    }
  }

  // === 处理数据行 ===
  for (var row = 2; row <= rowCount; row++) {
    if (isSelectedMode && selectedRows.indexOf(row) < 0) continue;
    if (isIncrementalMode) {
      var markVal = String(sheet.Cells(row, CONFIG.MARK_COL).Text || '').trim();
      if (markVal === CONFIG.MARK_TEXT) continue;
    }

    var dateTimeStr = String(sheet.Cells(row, col.BIRTH_DATE_TIME).Text || '').trim();
    var gender = String(sheet.Cells(row, col.GENDER).Text || '').trim();

    if (!dateTimeStr || !gender) { console.log('第 ' + row + ' 行: 跳过（缺少日期时间或性别）'); continue; }

    var parsed = parseDateTime(dateTimeStr);
    if (!parsed) {
      console.log('第 ' + row + ' 行: 日期时间格式无法识别: ' + dateTimeStr);
      errorCount++; errors.push({ row: row, error: '日期时间格式: ' + dateTimeStr });
      try { sheet.Cells(row, col.BASE_DUANYU).Value2 = '错误: 日期格式'; } catch(ex) {}
      continue;
    }

    console.log('处理第 ' + row + ' 行: ' + dateTimeStr + ' → ' + parsed.date + ' ' + parsed.time + ' ' + gender);

    try {
      // 调用 API 排盘+断语匹配
      var data = callBaziApi(parsed.date, parsed.time, gender);

      // 1. 八字原局（F 列）
      sheet.Cells(row, col.BAZI_DISP).Value2 = baziDisplayStr(data);

      // 2. 原局断语（G 列）
      var baseDuanyu = data.duanyu && data.duanyu.base ? formatDuanyuList(data.duanyu.base) : '';
      sheet.Cells(row, col.BASE_DUANYU).Value2 = baseDuanyu;

      // 3. 大运+流年断语（分组列）
      var validDayun = [];
      for (var vi = 0; vi < (data.dayun || []).length; vi++) {
        if (data.dayun[vi].ganZhi && data.dayun[vi].ganZhi.length > 0) {
          validDayun.push(data.dayun[vi]);
        }
      }
      var dayunCount = Math.min(col.DAYUN_COUNT, validDayun.length);
      for (var d = 0; d < dayunCount; d++) {
        var dy = validDayun[d];
        var dayunCol = col.GROUP_START + d * col.GROUP_WIDTH;

        // 大运断语
        var dyDuanyu = dy.duanyu ? formatDuanyuList(dy.duanyu) : '';
        var dyLabel = dy.ganZhi + '大运(' + dy.startAge + '-' + (dy.startAge + 9) + '岁)';
        sheet.Cells(row, dayunCol).Value2 = dyDuanyu ? (dyLabel + '\n' + dyDuanyu) : dyLabel;

        // 该大运下的流年断语
        var lnForDy = [];
        for (var t = 0; t < (data.liunian || []).length; t++) {
          if (data.liunian[t].dayunIndex === dy.index) lnForDy.push(data.liunian[t]);
        }
        for (var li = 0; li < lnForDy.length && li < col.LIUNIAN_PER_DAYUN; li++) {
          var ln = lnForDy[li];
          var lnCol = col.GROUP_START + d * col.GROUP_WIDTH + 1 + li;
          var lnDuanyu = ln.duanyu ? formatDuanyuList(ln.duanyu) : '';
          var lnLabel = dy.ganZhi + '大运-' + ln.ganZhi + '年(' + ln.year + '年)';
          sheet.Cells(row, lnCol).Value2 = lnDuanyu ? (lnLabel + '\n' + lnDuanyu) : lnLabel;
        }
      }

      processedCount++;
      matchCount += (data.duanyu && data.duanyu.base ? data.duanyu.base.length : 0);
      console.log('  完成!');

      // 增量模式：写入标记
      if (isIncrementalMode) {
        try { sheet.Cells(row, CONFIG.MARK_COL).Value2 = CONFIG.MARK_TEXT; } catch(ex) {}
      }

    } catch (e) {
      errorCount++;
      errors.push({ row: row, error: e.message });
      console.log('  错误: ' + e.message);
      try { sheet.Cells(row, col.BASE_DUANYU).Value2 = '错误: ' + e.message; } catch(ex) {}
    }

    if (row < rowCount) {
      sleep(CONFIG.REQUEST_INTERVAL_MS);
    }
  }

  console.log('');
  console.log('==================== 处理完成 ====================');
  console.log('总行数: ' + (rowCount - 1));
  console.log('已处理: ' + processedCount);
  console.log('匹配到断语: ' + matchCount);
  console.log('错误数: ' + errorCount);
  if (errors.length > 0) {
    console.log('错误详情:');
    for (var e = 0; e < errors.length; e++) console.log('  第 ' + errors[e].row + ' 行: ' + errors[e].error);
  }
  console.log('================================================');
}

// ============================================================
// ===================== 执行入口 ==============================
// ============================================================
try { main(); } catch (e) {
  console.log('脚本执行异常: ' + e.message);
  if (e.stack) console.log('堆栈: ' + e.stack);
}
