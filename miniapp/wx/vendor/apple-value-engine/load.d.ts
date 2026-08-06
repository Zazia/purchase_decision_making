/**
 * loadConstants: 解析 constants.json 文本, 校验必需字段, 映射中文键 → 英文类型字段
 *
 * constants.json 实际使用中文键名(如 "保值率曲线"), 本函数将其映射为
 * Constants 接口的英文字段名(如 retentionCurves), 使引擎公共 API 符合 spec 约定。
 * 映射表在此处集中维护, 调用方无感知。
 */
import type { Constants } from './types.js';
/**
 * 解析 constants.json 文本并校验。
 * @throws {ConstantsValidationError} 必需字段缺失时抛出, 错误信息含英文 spec 字段名
 * @throws {SyntaxError} JSON 解析失败
 */
export declare function loadConstants(jsonText: string): Constants;
/** 供调试: 查看键映射表 */
export declare function getKeyMap(): Readonly<Record<string, string>>;
//# sourceMappingURL=load.d.ts.map