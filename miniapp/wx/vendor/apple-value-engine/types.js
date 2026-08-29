/**
 * apple-value-engine 类型定义
 *
 * 注意: constants.json 实际使用中文键名, loadConstants() 内部完成
 * 中文键 → 英文字段名的映射。公共 API 仅暴露英文字段名(符合 spec 约定)。
 */
/** 常量校验错误 */
export class ConstantsValidationError extends Error {
    constructor(fieldName, message) {
        super(message ?? `Missing required field: ${fieldName}`);
        this.fieldName = fieldName;
        this.name = 'ConstantsValidationError';
    }
}
//# sourceMappingURL=types.js.map