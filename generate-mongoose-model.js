#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/* ----------------------------- Helpers chung ----------------------------- */
/** So khớp chuỗi ISO-8601 (định dạng chuẩn ngày/giờ), thay cho Date.parse()
 *  vốn quá "lỏng" và dễ nhận nhầm các chuỗi văn bản thường thành Date. */
function isISODateString(value) {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value);
}

/** Viết hoa chữ đầu mỗi "từ" (tách bởi -, _, khoảng trắng) rồi nối lại,
 *  giúp tên entity nhiều từ (vd: "movie-review") -> "MovieReview". */
function toPascalCase(str) {
  return str
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/** Số nhiều hoá đơn giản cho tên collection (không cần thư viện ngoài).
 *  Phủ các trường hợp tiếng Anh phổ biến: category->categories,
 *  box->boxes, hero->heroes, knife->knives, leaf->leaves, movie->movies. */
function pluralize(word) {
  const lower = word.toLowerCase();
  if (lower.endsWith('s') || lower.endsWith('es')) return word;

  const exceptions = {
    menu: 'menus',
    data: 'data',
    criteria: 'criteria',
    person: 'people',
    child: 'children',
  };
  if (exceptions[lower]) return exceptions[lower];

  if (/[^aeiou]y$/i.test(lower)) return word.replace(/y$/i, 'ies');
  if (/(s|x|z|ch|sh)$/i.test(lower)) return word + 'es';
  if (/[^aeiou]o$/i.test(lower)) return word + 'es';
  if (/fe$/i.test(lower)) return word.replace(/fe$/i, 'ves');
  if (/[^f]f$/i.test(lower)) return word.replace(/f$/i, 'ves');

  return word + 's';
}

/* ------------------------------ Suy luận kiểu ------------------------------ */

/**
 * Suy luận kiểu Mongoose từ một giá trị JSON, hỗ trợ định dạng MongoDB Export.
 */
/**
 * Suy luận kiểu Mongoose từ một giá trị JSON, có hỗ trợ tham số key để đoán ref/kiểu dữ liệu.
 */
function inferType(value, key = '') {
  if (value === null || value === undefined) return 'mongoose.Schema.Types.Mixed';

  // Định dạng MongoDB Export: { "$oid": "..." }, { "$date": "..." }
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (value.$oid) {
      let ref = '__TODO_REF_MODEL__';
      if (key.toLowerCase().endsWith('id')) {
        // Ví dụ: userId -> "User", reservationId -> "Reservation"
        const entityName = key.slice(0, -2);
        ref = entityName.charAt(0).toUpperCase() + entityName.slice(1);
      }
      return `{ type: mongoose.Schema.Types.ObjectId, ref: "${ref}" }`;
    }
    if (value.$date) return 'Date';
  }

  const type = typeof value;

  switch (type) {
    case 'string':
      if (isISODateString(value)) return 'Date';
      return 'String';
    case 'number':
      const moneyKeys = ['price', 'amount', 'total', 'fee', 'balance'];
      if (moneyKeys.some((k) => key.toLowerCase().includes(k))) {
        return 'Number';
      }
      return 'Number';
    case 'boolean':
      return 'Boolean';
    case 'object':
      if (Array.isArray(value)) {
        if (value.length > 0) {
          const innerType = inferType(value[0], key);
          if (typeof innerType === 'object') {
            return `[${stringifySchema(innerType, '    ')}]`;
          }
          return `[${innerType}]`;
        }
        return '[mongoose.Schema.Types.Mixed] /* TODO: mẫu rỗng */';
      }
      const nestedSchema = {};
      for (const k in value) {
        if (k === '_id') continue;
        // Truyền key hiện tại để hàm con có thể xử lý (ví dụ: tables -> tableSchema)
        nestedSchema[k] = inferType(value[k], k);
      }
      return nestedSchema;
    default:
      return 'mongoose.Schema.Types.Mixed';
  }
}
/**
 * Chuyển object định nghĩa kiểu thành chuỗi code đẹp (đệ quy theo indent).
 */
function stringifySchema(obj, indent = '  ') {
  let str = '{\n';
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && !Array.isArray(value)) {
      str += `${indent}${key}: ${stringifySchema(value, indent + '  ')},\n`;
    } else {
      str += `${indent}${key}: ${value},\n`;
    }
  }
  str += `${indent.slice(0, -2)}}`;
  return str;
}

/* ------------------------- Hợp nhất nhiều mẫu (mới) ------------------------ */

/**
 * Với 1 field, gom giá trị của field đó qua nhiều document mẫu rồi chọn ra
 * giá trị "thông tin nhất" để suy luận kiểu (ưu tiên giá trị không null và
 * không phải mảng rỗng), giúp tránh tình trạng 1 mẫu null/rỗng làm hỏng kiểu
 * suy luận khi mẫu khác có dữ liệu đầy đủ.
 */
function pickRepresentativeValue(samples, key) {
  const values = samples.map((s) => s[key]).filter((v) => v !== undefined);

  const rich = values.find((v) => v !== null && !(Array.isArray(v) && v.length === 0));
  return rich !== undefined ? rich : values[0];
}

/** Sinh object định nghĩa schema từ một hoặc nhiều document mẫu. */
function buildSchemaDefinition(samples) {
  const keys = new Set();
  samples.forEach((s) => Object.keys(s || {}).forEach((k) => keys.add(k)));

  const schemaDefinition = {};
  for (const key of keys) {
    if (key === '__v' || key === '_id') continue;
    // Truyền key vào đây:
    schemaDefinition[key] = inferType(pickRepresentativeValue(samples, key), key);
  }
  return schemaDefinition;
}

/* ------------------------------ Sinh nội dung ------------------------------ */

/**
 * Sinh nội dung file Mongoose Model (string) từ 1 hoặc nhiều document mẫu.
 * @param {Object|Object[]} jsonData - 1 document mẫu hoặc mảng nhiều mẫu.
 * @param {string} entityName - Tên entity (vd: "movie", "movie-review").
 */
function generateModelFile(jsonData, entityName) {
  const samples = Array.isArray(jsonData) ? jsonData : [jsonData];
  const schemaDefinition = buildSchemaDefinition(samples);
  const schemaContent = stringifySchema(schemaDefinition);

  const pascalName = toPascalCase(entityName); // -> tên Model, vd "MovieReview"
  const camelName = pascalName[0].toLowerCase() + pascalName.slice(1); // -> "movieReview"
  const collectionName = pluralize(camelName.toLowerCase()); // -> "moviereviews"
  const schemaVarName = `${camelName}Schema`;

  return `const mongoose = require("mongoose");

const ${schemaVarName} = new mongoose.Schema(${schemaContent});

module.exports = mongoose.model("${pascalName}", ${schemaVarName}, "${collectionName}");
`;
}

/* --------------------------------- I/O --------------------------------- */

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function deriveEntityName(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function isEntityConfigArray(json) {
  return (
    Array.isArray(json) &&
    json.length > 0 &&
    json.every((item) => item && typeof item === 'object' && 'name' in item && 'data' in item)
  );
}

function writeModelFile(outputDir, entityName, content) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `${entityName.toLowerCase()}.model.js`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function processEntity(name, data, outputDir) {
  const samples = Array.isArray(data) ? data : [data];
  if (samples.length === 0 || !samples[0]) {
    console.warn(`⚠️  Bỏ qua "${name}": không có dữ liệu mẫu hợp lệ.`);
    return null;
  }
  const content = generateModelFile(samples, name);
  const filePath = writeModelFile(outputDir, name, content);
  console.log(`Đã tạo: ${filePath}`);
  return filePath;
}

function printUsage() {
  console.log(`Cách dùng:
  node generate-mongoose-model.js <input.json | input-folder> [outputDir]

Định dạng input được hỗ trợ:
  1) File JSON chứa 1 document mẫu       -> tên entity lấy theo tên file
  2) File JSON chứa 1 mảng document mẫu (cùng entity, dùng để hợp nhất
     nhiều mẫu giúp suy luận kiểu chính xác hơn)
  3) File JSON dạng [{ "name": "movie", "data": {...} }, ...]
     -> sinh nhiều entity trong 1 lần chạy
  4) Thư mục chứa nhiều file .json, mỗi file là 1 entity

outputDir mặc định: ./models
`);
}

function main() {
  const [, , inputPath, outputDirArg] = process.argv;
  if (!inputPath) {
    printUsage();
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Không tìm thấy: "${inputPath}"`);
    process.exit(1);
  }

  const outputDir = outputDirArg || './models';
  const stat = fs.statSync(inputPath);
  const generated = [];

  if (stat.isDirectory()) {
    const files = fs.readdirSync(inputPath).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.error(`Không tìm thấy file .json nào trong "${inputPath}".`);
      process.exit(1);
    }
    for (const file of files) {
      const entityName = deriveEntityName(file);
      const json = readJSON(path.join(inputPath, file));
      const result = processEntity(entityName, json, outputDir);
      if (result) generated.push(result);
    }
  } else {
    const json = readJSON(inputPath);
    if (isEntityConfigArray(json)) {
      for (const { name, data } of json) {
        const result = processEntity(name, data, outputDir);
        if (result) generated.push(result);
      }
    } else {
      const entityName = deriveEntityName(inputPath);
      const result = processEntity(entityName, json, outputDir);
      if (result) generated.push(result);
    }
  }

  console.log(`\nHoàn tất! Đã sinh ${generated.length} model file vào "${outputDir}".`);
}

if (require.main === module) {
  main();
}

module.exports = {
  inferType,
  stringifySchema,
  generateModelFile,
  processEntity,
  pluralize,
  toPascalCase,
  isISODateString,
};
