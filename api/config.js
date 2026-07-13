// Vercel 环境配置 API
// 在 Vercel 环境变量中设置：SUPABASE_URL, SUPABASE_KEY, ADMIN_EMAIL
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  // 从请求头自动获取域名（支持自定义域名）
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = host ? protocol + '://' + host : '';

  return res.json({
    supabase_url: process.env.SUPABASE_URL || '',
    supabase_key: process.env.SUPABASE_KEY || '',
    admin_email: process.env.ADMIN_EMAIL || '',
    api_bazi_url: (baseUrl ? baseUrl + '/api/bazi' : '') || '',
    vercel_env: process.env.VERCEL_ENV || 'development'
  });
};
