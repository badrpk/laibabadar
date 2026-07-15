const http = require('http');
const port = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('OK'); }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end('<h1>laibabadar: It works ✅</h1>');
});
server.listen(port, '0.0.0.0', () => console.log('listening on', port));
