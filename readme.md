# Generate Mongoose Model

Công cụ CLI tự động tạo file Mongoose Schema/Model (.js) từ dữ liệu JSON mẫu. Hỗ trợ tốt các định dạng MongoDB Export (`$oid`, `$date`).

## Cài đặt

Yêu cầu: [Node.js](https://nodejs.org/) đã được cài đặt.

## Cách dùng (CLI)

```bash
node generate-mongoose-model.js <input.json | input-folder> [outputDir]
```

Xử lý nhiều model cùng 1 lúc

Tạo thư mục inputs và models sau đó ném các file models.json vào inputs

```bash
node generate-mongoose-model.js .\inputs\ .\models\
```

Tính năng nổi bật
Tự động đoán Reference: Tự nhận diện userId -> ref: "User".

Thông minh: Tự động nhận diện kiểu Date (ISO string) và các trường tiền tệ (price, amount, etc.).

Thông minh hóa Schema: Hợp nhất nhiều mẫu dữ liệu để tạo ra Schema đầy đủ nhất.

Chuẩn hóa: Tự động chuyển tên entity sang PascalCase và số nhiều hóa collection name.
