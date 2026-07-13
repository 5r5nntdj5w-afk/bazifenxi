const { Solar, Lunar } = require('lunar-javascript');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.json({
      name: '八字排盘 API',
      version: '1.0',
      endpoints: {
        'POST /api/bazi':       '单条排盘计算',
        'POST /api/bazi/batch': '批量排盘计算（最多 50 条）'
      }
    });
  }

  // --- POST /api/bazi (single) ---
  if (req.method === 'POST' && !req.query.batch) {
    try {
      const result = calculateBazi(req.body);
      return res.json(result);
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  // --- POST /api/bazi?batch=1 (batch) ---
  if (req.method === 'POST' && req.query.batch) {
    try {
      const { records } = req.body;
      if (!records || !Array.isArray(records)) {
        return res.status(400).json({ success: false, error: '缺少 records 数组参数' });
      }
      if (records.length > 50) {
        return res.status(400).json({ success: false, error: '批量查询最多 50 条' });
      }

      const results = [], errors = [];
      for (let i = 0; i < records.length; i++) {
        try {
          const r = calculateBazi(records[i]);
          if (r.success) results.push(r.data);
          else errors.push({ index: i, error: r.error, input: records[i] });
        } catch (e) {
          errors.push({ index: i, error: e.message, input: records[i] });
        }
      }

      return res.json({
        success: true,
        total: records.length,
        successCount: results.length,
        errorCount: errors.length,
        data: results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  }

  return res.status(404).json({ error: 'Not found' });
};

// ========== 排盘核心逻辑 ==========

function calculateBazi(params) {
  const { birthDate, birthTime, gender, calendarType = 'solar', isLeapMonth = false } = params;

  if (!birthDate || !birthTime || gender === undefined || gender === null) {
    return { success: false, error: '缺少必要参数：birthDate, birthTime, gender' };
  }

  const year = parseInt(birthDate.substring(0, 4));
  const month = parseInt(birthDate.substring(4, 6));
  const day = parseInt(birthDate.substring(6, 8));
  const hour = parseInt(birthTime.substring(0, 2));
  const minute = parseInt(birthTime.substring(2, 4));

  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) {
    return { success: false, error: '日期或时间格式无效' };
  }

  const genderNum = parseInt(gender);
  if (genderNum !== 0 && genderNum !== 1) {
    return { success: false, error: '性别值无效：1=男, 0=女' };
  }

  let solar;
  if (calendarType === 'lunar') {
    const lm = isLeapMonth ? -month : month;
    const ld = Lunar.fromYmd(year, lm, day);
    const sd = ld.getSolar();
    solar = Solar.fromYmdHms(sd.getYear(), sd.getMonth(), sd.getDay(), hour, minute, 0);
  } else {
    solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
  }

  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();
  ec.setSect(1);

  const bazi = {
    nian: { gan: ec.getYearGan(), zhi: ec.getYearZhi() },
    yue:  { gan: ec.getMonthGan(), zhi: ec.getMonthZhi() },
    ri:   { gan: ec.getDayGan(),   zhi: ec.getDayZhi() },
    shi:  { gan: ec.getTimeGan(),  zhi: ec.getTimeZhi() }
  };

  const wuxing = {
    nian: ec.getYearWuXing(), yue: ec.getMonthWuXing(),
    ri:   ec.getDayWuXing(),   shi: ec.getTimeWuXing()
  };

  const nayin = {
    nian: ec.getYearNaYin(), yue: ec.getMonthNaYin(),
    ri:   ec.getDayNaYin(),   shi: ec.getTimeNaYin()
  };

  const shishenGan = {
    nian: ec.getYearShiShenGan(), yue: ec.getMonthShiShenGan(),
    ri:   ec.getDayShiShenGan(),   shi: ec.getTimeShiShenGan()
  };

  const zhiZangGan = { '子':'癸','丑':'己','寅':'甲','卯':'乙','辰':'戊','巳':'丙',
    '午':'丁','未':'己','申':'庚','酉':'辛','戌':'戊','亥':'壬' };
  const getZhiZangGan = (z) => zhiZangGan[z] || '';

  const shishenZhi = {
    nian: getZhiZangGan(bazi.nian.zhi), yue: getZhiZangGan(bazi.yue.zhi),
    ri:   getZhiZangGan(bazi.ri.zhi),   shi: getZhiZangGan(bazi.shi.zhi)
  };

  const shengXiao = lunar.getYearShengXiao();
  const riGan = ec.getDayGan();
  const riZhi = ec.getDayZhi();

  // 大运
  const yun = ec.getYun(genderNum, 1);
  const dyList = yun.getDaYun(12);
  const dayun = dyList.map((dy, i) => ({
    index: i,
    ganZhi: dy.getGanZhi(),
    gan: dy.getGanZhi().charAt(0),
    zhi: dy.getGanZhi().charAt(1),
    startAge: dy.getStartAge(),
    startYear: dy.getStartYear(),
    endYear: dy.getEndYear()
  }));

  // 起运信息
  const ss = yun.getStartSolar();
  const qiyun = {
    startAge: dayun.length > 0 ? dayun[0].startAge : 0,
    startYear: yun.getStartYear(),
    startMonth: ss ? ss.getMonth() : 0,
    startDay: ss ? ss.getDay() : 0,
    isForward: yun.isForward()
  };

  // 流年
  const currentYear = new Date().getFullYear();
  const liunian = [];
  for (const dy of dayun) {
    const limit = Math.min(dy.endYear - dy.startYear + 1, 3);
    for (let i = 0; i < limit; i++) {
      const ly = dy.startYear + i;
      const gz = getYearGanZhi(ly);
      liunian.push({
        year: ly,
        gan: gz.gan,
        zhi: gz.zhi,
        ganZhi: gz.gan + gz.zhi,
        dayunGan: dy.gan,
        dayunZhi: dy.zhi,
        dayunGanZhi: dy.ganZhi,
        dayunIndex: dy.index,
        isCurrentYear: ly === currentYear
      });
    }
  }

  return {
    success: true,
    data: {
      bazi, wuxing, nayin, shishenGan, shishenZhi,
      shengXiao, riGan, riZhi,
      gender: genderNum === 1 ? '男' : '女',
      qiyun, dayun, liunian,
      // 数组格式（前端页面兼容）
      baziGan: [bazi.nian.gan, bazi.yue.gan, bazi.ri.gan, bazi.shi.gan],
      baziZhi: [bazi.nian.zhi, bazi.yue.zhi, bazi.ri.zhi, bazi.shi.zhi],
      shishenGanArr: [shishenGan.nian, shishenGan.yue, shishenGan.ri, shishenGan.shi],
      shishenZhiArr: [shishenZhi.nian, shishenZhi.yue, shishenZhi.ri, shishenZhi.shi]
    }
  };
}

const TIAN_GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const DI_ZHI  = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

function getYearGanZhi(year) {
  const offset = year - 1984;
  return {
    gan: TIAN_GAN[((offset % 10) + 10) % 10],
    zhi: DI_ZHI[((offset % 12) + 12) % 12]
  };
}
