# Generate Mongoose Model

Công cụ CLI tự động tạo file Mongoose Schema/Model (.js) từ dữ liệu JSON mẫu. Hỗ trợ tốt các định dạng MongoDB Export (`$oid`, `$date`).

## Cài đặt

Yêu cầu: [Node.js](https://nodejs.org/) đã được cài đặt.

## Cách dùng (CLI)

```bash
node generate-mongoose-model.js <input.json | input-folder> [outputDir] [flags]
```

Flags:

- `--cjs` (mặc định) / `--esm`: định dạng output require hay import.
- `--timestamps`, `-t`: thêm `{ timestamps: true }` vào schema (mặc định tắt).
- `--output`, `-o`: thư mục đầu ra.


Xử lý nhiều model cùng 1 lúc

Tạo thư mục inputs và models sau đó ném các file models.json vào inputs

```bash
node generate-mongoose-model.js .\inputs\ .\models\
```

Tính năng nổi bật

Resolve Reference chính xác: khi chạy cả thư mục, tool đọc `_id` của mọi document để lập bản đồ `ObjectId -> Model`, rồi tra từng khóa ngoại (`$oid`) về đúng Model nó trỏ tới. Nhờ đó `ref` khớp tên model thật (`depId -> Departments`, `managerId -> Employees`, `supervisorId -> Employees` tự nhận self-reference) và `.populate()` chạy được ngay, không cần sửa tay.

Fallback theo tên field: nếu không tra được `$oid` (vd chạy 1 file lẻ), tool đoán ref từ tên field (`userId -> User`) và kèm comment `TODO` để nhắc review.

Thông minh: Tự động nhận diện kiểu Date (ISO string), Boolean, Number, Decimal128 (`$numberDecimal`).

Thông minh hóa Schema: Hợp nhất nhiều mẫu dữ liệu để tạo ra Schema đầy đủ nhất; gợi ý `unique`/`enum` từ data mẫu.

Chuẩn hóa: Tự động chuyển tên entity sang PascalCase và số nhiều hóa collection name.

> Lưu ý: resolve chính xác chỉ hoạt động khi chạy nguyên thư mục (các file share cùng bộ ObjectId). Chạy 1 file lẻ sẽ rơi về fallback theo tên field.

