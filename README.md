# baogia.vtec.food — bảng giá VTEC tự sửa được

- `server.mjs` — máy chủ một tệp (Node thuần, không gói ngoài), PM2 `baogia`, cổng 3077.
- `public/trang.html` — trang báo giá; `public/media/` — ảnh/video mặc định.
- `du-lieu/` (chỉ trên máy chủ): `noidung.json` chữ đã sửa, `media/` tệp tải lên, `lien-he.jsonl` khách để lại số.
- `/cai-dat` — nhập mật khẩu (MATKHAU trong `.env` trên VPS) → sửa chữ, thay ảnh, gắn video ngay trên trang.
- Deploy: `tar czf - server.mjs public | ssh -p 24700 root@103.216.118.34 "tar xzf - -C /var/www/baogia-vtec && pm2 restart baogia"`
  (KHÔNG đụng du-lieu/ và .env trên máy chủ.)
