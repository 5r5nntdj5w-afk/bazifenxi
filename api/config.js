// Vercel 环境配置 API
// 后端读取环境变量，前端通过此接口获取配置
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  return res.json({
    supabase_url: process.env.SUPABASE_URL || '',
    supabase_key: process.env.SUPABASE_KEY || '',
    admin_email: process.env.ADMIN_EMAIL || 'jsqdzz@qq.com',
    api_bazi_url: (process.env.VERCEL_URL
      ? 'https://' + process.env.VERCEL_URL + '/api/bazi'
      : '') || '',
    vercel_env: process.env.VERCEL_ENV || 'development'
  });
};
