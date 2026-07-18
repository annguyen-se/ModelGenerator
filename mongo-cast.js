// Transform JSON mẫu sang kiểu Mongo thật (giống import-data.js).
// Dùng chung cho tool sinh model: chạy cast -> suy luận typeof -> ra schema khớp 100% với data import.
// Chỉ phụ thuộc mongoose (đã có sẵn trong project); ObjectId lấy từ mongoose.Types.
'use strict';

const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;

/**
 * Đệ quy chuyển object theo quy ước MongoDB Extended JSON:
 *  - {$oid: "..."}    -> ObjectId
 *  - {$date: "..."}   -> Date
 *  - {$numberDecimal:"..."} -> Number
 *  - object lồng      -> cast từng field
 *  - array            -> cast từng phần tử
 *  - nguyên thủy     -> giữ nguyên
 */
function castMongo(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(castMongo);
  if (typeof value === 'object') {
    if ('$oid' in value) return new ObjectId(String(value.$oid));
    if ('$date' in value) return new Date(value.$date);
    if ('$numberDecimal' in value) return parseFloat(value.$numberDecimal);
    const out = {};
    for (const k of Object.keys(value)) out[k] = castMongo(value[k]);
    return out;
  }
  return value;
}

module.exports = { castMongo };
