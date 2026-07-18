# Generate Mongoose Model

Công cụ CLI tự động tạo file Mongoose Schema/Model (.js) từ dữ liệu JSON mẫu. Hỗ trợ tốt các định dạng MongoDB Export (`$oid`, `$date`).

## Cài đặt

Yêu cầu: [Node.js](https://nodejs.org/) đã được cài đặt.

```bash
npm install
```

(Chỉ cần `mongoose` — dùng để tạo `ObjectId`/`Date` instance trong `mongo-cast.js`.)

## Cách dùng (CLI)

```bash
node generate-mongoose-model.js <input.json | input-folder> [outputDir] [flags]
```

### Flags

- `--cjs` (mặc định) / `--esm`: định dạng output (`require` hay `import`).
- `--timestamps`, `-t`: thêm `{ timestamps: true }` vào schema. **Mặc định tắt.** Cần thiết khi data JSON có sẵn `createdAt`/`updatedAt` mà bạn muốn Mongoose tự quản.
- `--output`, `-o`: thư mục đầu ra (thay thế cho positional `outputDir`).

### Ví dụ

Xử lý nguyên thư mục (khuyến nghị — `ref` được resolve chính xác):

```bash
node generate-mongoose-model.js .\inputs\ .\models\
```

Bật timestamps:

```bash
node generate-mongoose-model.js .\inputs\ .\models\ --timestamps
```

Output ESM:

```bash
node generate-mongoose-model.js .\inputs\ .\models\ --esm --timestamps
```

## Tính năng nổi bật

**Resolve Reference chính xác**: khi chạy cả thư mục, tool đọc `_id` của mọi document để lập bản đồ `ObjectId -> Model`, rồi tra từng khóa ngoại (`$oid`) về đúng Model nó trỏ tới. Nhờ đó `ref` khớp tên model thật (`depId -> Departments`, `managerId -> Employees`, `supervisorId -> Employees` tự nhận self-reference) và `.populate()` chạy được ngay, không cần sửa tay.

**Fallback theo tên field**: nếu không tra được `$oid` (vd chạy 1 file lẻ), tool đoán ref từ tên field (`userId -> User`) và kèm comment `TODO` để nhắc review.

**Nhận diện kiểu theo document đã cast**: tool chuyển mỗi document qua `mongo-cast.js` (chuyển `{$oid:...}` → `ObjectId` instance, `{$date:...}` → `Date` instance, `{$numberDecimal:...}` → `Number`) trước khi suy luận kiểu. Kết quả khớp với document thật khi insert bằng `import-data.js`:

- `{$oid: ...}` → `ObjectId`, ref tới model đúng.
- `{$date: ...}` → `Date`.
- `{$numberDecimal: ...}` → `Number` (kèm comment gợi ý `Decimal128`).
- String ISO thường (không có `$date`) → giữ `String` — không đoán nhầm thành Date.

**Gợi ý schema**: hợp nhất nhiều mẫu để ra schema đầy đủ nhất; gợi ý `enum` từ tập giá trị nhỏ; **chỉ tự gắn `unique: true` khi tên field có khóa duy nhất (`email`, `username`, `code`, `sku`, `slug`, `phoneNumber`, `accountNumber`)**. Với field khác mà data trùng khớp toàn bộ, tool chỉ gắn `/* TODO: unique? */` để tránh ràng buộc sai gây `E11000` khi insert.

**Chuẩn hóa**: tên entity → PascalCase cho cả `model name`, `file name` (vd `Users.js`) và `ref`; tên collection → chữ thường (theo quy ước Mongo, do Mongoose tự suy ra từ model name).
