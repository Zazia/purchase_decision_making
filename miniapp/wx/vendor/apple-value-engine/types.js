"use strict";
/**
 * apple-value-engine 类型定义
 *
 * 注意: constants.json 实际使用中文键名, loadConstants() 内部完成
 * 中文键 → 英文字段名的映射。公共 API 仅暴露英文字段名(符合 spec 约定)。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConstantsValidationError = void 0;
/** 常量校验错误 */
class ConstantsValidationError extends Error {
    constructor(fieldName, message) {
        super(message ?? `Missing required field: ${fieldName}`);
        this.fieldName = fieldName;
        this.name = 'ConstantsValidationError';
    }
}
exports.ConstantsValidationError = ConstantsValidationError;
//# sourceMappingURL=types.js.map