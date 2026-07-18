#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

/* ----------------------------- Helpers chung ----------------------------- */
function isISODateString(value) {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value);
}

function toPascalCase(str) {
  return str
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

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

/* -------------------- Heuristic phát hiện ObjectId ref ------------------- */

const SELF_REF_KEYS = new Set([
  'manager',
  'supervisor',
  'managedBy',
  'reportTo',
  'reportsTo',
  'parent',
  'parentId',
  'parentNode',
]);

function looksLikeForeignKey(key) {
  return /(_id|Id)$/.test(key) && key !== '_id';
}

function extractRefFromKey(key) {
  const cleaned = key.replace(/(_id|Id)$/, '');
  return toPascalCase(cleaned);
}

function looksLikeObjectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

// Nguồn ref chỉ đoán được từ TÊN field, không biết $oid trỏ tới collection nào.
// -> self-ref ưu tiên trước; ref đoán từ tên luôn kèm TODO để bắt buộc review.
// ponytail: heuristic theo tên field, chỉ dùng khi KHÔNG resolve được oid -> model thật
function refObject(key) {
  // self-ref có thể ở dạng 'supervisor' hoặc 'supervisorId' -> đối chiếu cả bản đã bỏ hậu tố Id
  const base = key.replace(/(_id|Id)$/, '');
  if (SELF_REF_KEYS.has(key) || SELF_REF_KEYS.has(base)) {
    return {
      def: `{ type: mongoose.Schema.Types.ObjectId, ref: '__SELF__' }`,
      todo: ` /* TODO: thay __SELF__ bằng tên Model hiện tại (self-reference) */`,
    };
  }
  if (looksLikeForeignKey(key)) {
    return {
      def: `{ type: mongoose.Schema.Types.ObjectId, ref: '${extractRefFromKey(key)}' }`,
      todo: ` /* TODO: xác nhận ref (đoán từ tên field, có thể viết tắt) */`,
    };
  }
  return {
    def: `{ type: mongoose.Schema.Types.ObjectId, ref: '__TODO__' }`,
    todo: ` /* TODO: điền tên Model */`,
  };
}

/* --------- Resolve ref chính xác bằng cách tra oid -> Model thật --------- */

function extractOid(idVal) {
  if (idVal == null) return null;
  if (typeof idVal === 'string') return /^[a-f\d]{24}$/i.test(idVal) ? idVal.toLowerCase() : null;
  if (typeof idVal === 'object' && idVal.$oid) return String(idVal.$oid).toLowerCase();
  return null;
}

// entities: [{ name, data }]  ->  Map(oid -> ModelPascalName)
function buildOidIndex(entities) {
  const map = new Map();
  for (const { name, data } of entities) {
    const model = toPascalCase(name);
    const samples = Array.isArray(data) ? data : [data];
    for (const doc of samples) {
      const oid = doc && extractOid(doc._id);
      if (oid) map.set(oid, model);
    }
  }
  return map;
}

// Có oid + index -> ref = Model thật (không TODO). Không -> fallback heuristic tên field.
function resolveRef(key, oidStr, context) {
  const idx = context && context.oidToModel;
  const model = idx && oidStr && idx.get(String(oidStr).toLowerCase());
  if (model) {
    return { def: `{ type: mongoose.Schema.Types.ObjectId, ref: '${model}' }`, todo: '' };
  }
  return refObject(key);
}

/* ------------------------------ Suy luận kiểu ------------------------------ */

function inferType(value, key = '', context = {}) {
  if (value === null || value === undefined) {
    if (SELF_REF_KEYS.has(key) || looksLikeForeignKey(key)) {
      const { def, todo } = refObject(key); // null -> không có oid để tra, dùng heuristic
      return `${def}${todo}`;
    }
    return 'mongoose.Schema.Types.Mixed /* TODO: null trong mẫu - xác nhận kiểu thực */';
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    if ('$oid' in value) {
      const { def, todo } = resolveRef(key, value.$oid, context);
      return `${def}${todo}`;
    }
    if ('$date' in value) return 'Date';
    if ('$numberDecimal' in value) return 'Number /* Decimal128 - cân nhắc dùng mongoose.Schema.Types.Decimal128 */';
  }

  const type = typeof value;

  switch (type) {
    case 'string':
      if (isISODateString(value)) return 'Date';
      if (looksLikeObjectId(value)) {
        const { def, todo } = resolveRef(key, value, context);
        return `${def}${todo}`;
      }
      if (SELF_REF_KEYS.has(key) || SELF_REF_KEYS.has(key.replace(/(_id|Id)$/, ''))) {
        return `{ type: mongoose.Schema.Types.ObjectId, ref: '__SELF__' } /* TODO: thay __SELF__ bằng tên Model hiện tại (self-reference; data mẫu đang lưu string) */`;
      }
      return 'String';

    case 'number':
      return 'Number';

    case 'boolean':
      return 'Boolean';

    case 'object':
      if (Array.isArray(value)) {
        if (value.length === 0) {
          if (looksLikeForeignKey(key) || key.toLowerCase().endsWith('ids')) {
            return `[{ type: mongoose.Schema.Types.ObjectId, ref: '__TODO__' }] /* TODO: mảng ref - điền tên Model */`;
          }
          return `[mongoose.Schema.Types.Mixed] /* TODO: mảng rỗng trong mẫu - xác nhận kiểu phần tử */`;
        }
        const first = value[0];
        if (typeof first === 'object' && first !== null && '$oid' in first) {
          const { def, todo } = resolveRef(key, first.$oid, context);
          return `[${def}]${todo}`;
        }
        const innerType = inferType(first, key, context);
        if (typeof innerType === 'object') {
          return `[${stringifySchema(innerType, '    ')}]`;
        }
        return `[${innerType}]`;
      }

      const nestedSchema = {};
      for (const k in value) {
        if (k === '_id') continue;
        nestedSchema[k] = inferType(value[k], k, context);
      }
      return nestedSchema;

    default:
      return 'mongoose.Schema.Types.Mixed';
  }
}

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

/* ------------------- Phân tích thêm từ nhiều mẫu ------------------- */

function pickRepresentativeValue(samples, key) {
  const values = samples.map((s) => s[key]).filter((v) => v !== undefined);
  if (values.length === 0) return undefined;
  const best = values.find((v) => v !== null && !(Array.isArray(v) && v.length === 0));
  return best !== undefined ? best : values[0];
}

function detectEnum(samples, key) {
  const skipPatterns = [
    /name|email|password|url|description|title|address|phone|token|slug|message|comment|manager|owner|author|creator/i,
  ];
  if (skipPatterns.some((p) => p.test(key))) return null;
  if (looksLikeForeignKey(key)) return null;
  const values = samples.map((s) => s[key]).filter((v) => v !== null && v !== undefined && typeof v === 'string');
  if (values.length < 2) return null;
  const unique = [...new Set(values)];
  if (unique.length >= 2 && unique.length <= Math.min(10, Math.ceil(samples.length / 2))) {
    return unique;
  }
  return null;
}

function detectUnique(samples, key) {
  if (samples.length < 3) return false;
  const values = samples
    .map((s) => s[key])
    .filter((v) => v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number'));
  if (values.length < samples.length) return false;
  const unique = new Set(values);
  return unique.size === values.length;
}

function buildSchemaDefinition(samples, context = {}) {
  const keys = new Set();
  samples.forEach((s) => Object.keys(s || {}).forEach((k) => keys.add(k)));

  const schemaDefinition = {};
  for (const key of keys) {
    if (key === '__v' || key === '_id') continue;

    const representative = pickRepresentativeValue(samples, key);
    let typeDef = inferType(representative, key, context);
    const isUnique = detectUnique(samples, key);

    if (typeDef === 'String') {
      const enumValues = detectEnum(samples, key);
      if (enumValues) {
        const enumStr = enumValues.map((v) => `'${v}'`).join(', ');
        const enumNote = 'TODO: enum chỉ từ data mẫu - kiểm tra có thiếu value nào không';
        typeDef = `{ type: String, enum: [${enumStr}] } /* ${enumNote} */`;
      } else if (isUnique) {
        typeDef = `{ type: String, unique: true }`;
      }
    }

    schemaDefinition[key] = typeDef;
  }
  return schemaDefinition;
}

/* ------------------------------ Templates output ------------------------------ */

function renderCJS(pascalName, schemaVarName, schemaContent, collectionName, timestamps) {
  const schemaOptions = timestamps ? `{ timestamps: true }` : `{}`;
  return `const mongoose = require('mongoose');

const ${schemaVarName} = new mongoose.Schema(
${schemaContent},
  ${schemaOptions}
);

module.exports = mongoose.model('${pascalName}', ${schemaVarName}, '${collectionName}');
`;
}

function renderESM(pascalName, schemaVarName, schemaContent, collectionName, timestamps) {
  const schemaOptions = timestamps ? `{ timestamps: true }` : `{}`;
  return `import mongoose from 'mongoose';

const ${schemaVarName} = new mongoose.Schema(
${schemaContent},
  ${schemaOptions}
);

export default mongoose.model('${pascalName}', ${schemaVarName}, '${collectionName}');
`;
}

/* ------------------------------ Sinh nội dung ------------------------------ */

function countTodos(content) {
  return (content.match(/TODO/g) || []).length;
}

/**
 * @param {object|object[]} jsonData
 * @param {string}          entityName
 * @param {'cjs'|'esm'}     mode       - output format (default: 'cjs')
 * @param {boolean}         timestamps - thêm { timestamps: true } vào schema (default: false)
 * @param {object}          context    - { oidToModel: Map } để resolve ref chính xác
 */
function generateModelFile(jsonData, entityName, mode = 'cjs', timestamps = false, context = {}) {
  const samples = Array.isArray(jsonData) ? jsonData : [jsonData];
  const schemaDefinition = buildSchemaDefinition(samples, context);
  const schemaContent = stringifySchema(schemaDefinition);

  const pascalName = toPascalCase(entityName);
  const camelName = pascalName[0].toLowerCase() + pascalName.slice(1);
  const collectionName = pluralize(pascalName).toLowerCase();
  const schemaVarName = `${camelName}Schema`;

  const content =
    mode === 'esm'
      ? renderESM(pascalName, schemaVarName, schemaContent, collectionName, timestamps)
      : renderCJS(pascalName, schemaVarName, schemaContent, collectionName, timestamps);

  const todoCount = countTodos(content);
  if (todoCount > 0) {
    return { content, warnings: [`${todoCount} TODO cần review thủ công trong schema.`] };
  }
  return { content, warnings: [] };
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
  const fileName = `${entityName.toLowerCase()}.js`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function processEntity(name, data, outputDir, mode, timestamps, context = {}) {
  const samples = Array.isArray(data) ? data : [data];
  if (samples.length === 0 || !samples[0]) {
    console.warn(`Bỏ qua "${name}": không có dữ liệu mẫu hợp lệ.`);
    return null;
  }

  const { content, warnings } = generateModelFile(samples, name, mode, timestamps, context);
  const filePath = writeModelFile(outputDir, name, content);

  console.log(`✅ Đã tạo: ${filePath}`);
  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(`   ⚠️  ${w}`));
  }
  return filePath;
}

/* --------------------------------- CLI --------------------------------- */

function parseArgs(argv) {
  const args = argv.slice(2);
  let mode = 'cjs';
  let timestamps = false;
  let outputDir = null;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--esm') {
      mode = 'esm';
    } else if (arg === '--cjs') {
      mode = 'cjs';
    } else if (arg === '--timestamps' || arg === '-t') {
      timestamps = true;
    } else if (arg === '--output' || arg === '-o') {
      outputDir = args[++i];
    } else if (arg.startsWith('--output=')) {
      outputDir = arg.slice('--output='.length);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return {
    inputPath: positional[0] || null,
    outputDir: outputDir || positional[1] || './models',
    mode,
    timestamps,
  };
}

function printUsage() {
  console.log(`Cách dùng:
  node generate-mongoose-model.js <input.json | input-folder> [outputDir] [flags]

Flags:
  --cjs              Output dùng require / module.exports  (mặc định)
  --esm              Output dùng import / export default
  --timestamps, -t   Thêm { timestamps: true } vào schema  (mặc định: không có)
  --output, -o       Thư mục đầu ra (thay thế cho positional outputDir)

Định dạng input được hỗ trợ:
  1) File JSON chứa 1 document mẫu            -> tên entity lấy theo tên file
  2) File JSON chứa mảng document cùng entity -> hợp nhất nhiều mẫu
  3) File JSON dạng [{ "name": "...", "data": {...} }, ...]
     -> sinh nhiều entity trong 1 lần chạy
  4) Thư mục chứa nhiều file .json, mỗi file là 1 entity

Ví dụ:
  node generate-mongoose-model.js data/user.json
  node generate-mongoose-model.js data/user.json --timestamps
  node generate-mongoose-model.js data/user.json --esm --timestamps
  node generate-mongoose-model.js data/ ./src/models --esm -t
  node generate-mongoose-model.js entities.json -o ./models --cjs

Tính năng tự động:
  - Phát hiện ObjectId ref từ tên field (userId, department_id, ...)
  - Phát hiện self-reference (manager, supervisor, parent, reportTo...)
  - Gợi ý unique: true nếu tất cả giá trị đều khác nhau (>= 3 mẫu)
  - Gợi ý enum khi field String có ít giá trị unique (kèm cảnh báo thiếu value)
  - Cảnh báo số lượng TODO cần review thủ công
`);
}

function main() {
  const { inputPath, outputDir, mode, timestamps } = parseArgs(process.argv);

  if (!inputPath) {
    printUsage();
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Không tìm thấy: "${inputPath}"`);
    process.exit(1);
  }

  console.log(`📦 Mode: ${mode.toUpperCase()} | Timestamps: ${timestamps ? 'bật' : 'tắt'}\n`);

  const stat = fs.statSync(inputPath);
  const generated = [];
  let totalWarnings = 0;

  // Gom toàn bộ entity trước -> build index oid->Model -> resolve ref chính xác
  const entities = [];
  if (stat.isDirectory()) {
    const files = fs.readdirSync(inputPath).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      console.error(`Không tìm thấy file .json nào trong "${inputPath}".`);
      process.exit(1);
    }
    for (const file of files) {
      entities.push({ name: deriveEntityName(file), data: readJSON(path.join(inputPath, file)) });
    }
  } else {
    const json = readJSON(inputPath);
    if (isEntityConfigArray(json)) {
      for (const { name, data } of json) entities.push({ name, data });
    } else {
      entities.push({ name: deriveEntityName(inputPath), data: json });
    }
  }

  const context = { oidToModel: buildOidIndex(entities) };
  for (const { name, data } of entities) {
    const result = processEntity(name, data, outputDir, mode, timestamps, context);
    if (result) generated.push(result);
  }

  console.log(`\nHoàn tất! Đã sinh ${generated.length} model file (${mode.toUpperCase()}) vào "${outputDir}".`);
  if (totalWarnings > 0) {
    console.warn(`⚠️  Hãy tìm kiếm "TODO" trong các file vừa tạo để hoàn thiện schema.`);
  }
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
  detectEnum,
  detectUnique,
  looksLikeForeignKey,
  extractRefFromKey,
  buildOidIndex,
  resolveRef,
  extractOid,
};
