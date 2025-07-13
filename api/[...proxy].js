// 文件路径: api/[...proxy].js (用于调试的最小化版本)

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 检查鉴权，以确保测试环境与真实情况一致
  const proxyAuthKey = process.env.PROXY_AUTH_KEY;
  const authHeader = request.headers.get("Authorization");
  if (!proxyAuthKey || !authHeader || !authHeader.startsWith("Bearer ") || authHeader.substring("Bearer ".length).trim() !== proxyAuthKey) {
      return new Response("Unauthorized.", { status: 401 });
  }

  // 为调试目的，直接返回收到的路径信息
  const responseBody = {
    message: "✅ Success! The minimal test function was executed.",
    note: "If you see this message, it means your vercel.json rewrite rule and deployment are WORKING CORRECTLY.",
    request_details: {
        url: request.url,
        pathname: pathname,
    }
  };

  // 直接响应，不进行任何外部请求
  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" // 保持CORS开放
    },
  });
}
