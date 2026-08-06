"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConstantsValidationError = exports.computeParetoFrontier = exports.getBuyPrice = exports.getCurrentNewPrice = exports.computeMaintenanceCost = exports.computeMonthlyCost = exports.getEffectiveR = exports.getStorageWeight = exports.getMemoryWeight = exports.getCategoryFlagshipScore = exports.getChipMultiCoreScore = exports.getChipCoefficient = exports.computePerformance = exports.getRetentionRate = exports.getKeyMap = exports.loadConstants = void 0;
/**
 * apple-value-engine
 *
 * 苹果产品价值分析与帕累托前沿计算引擎。
 * 纯函数, 零运行时依赖, 支持 Node / 浏览器 / 微信小程序三端。
 *
 * 用法:
 *   import { loadConstants, computeParetoFrontier } from 'apple-value-engine';
 *   const constants = loadConstants(jsonText);
 *   const result = computeParetoFrontier(constants, {
 *     category: 'mac-mini',
 *     budget: 5000,
 *     holdingYears: [2, 3, 4],
 *     buyTiming: 'used',
 *     performanceFloor: 0.7,
 *   });
 */
var load_js_1 = require("./load.js");
Object.defineProperty(exports, "loadConstants", { enumerable: true, get: function () { return load_js_1.loadConstants; } });
Object.defineProperty(exports, "getKeyMap", { enumerable: true, get: function () { return load_js_1.getKeyMap; } });
var retention_js_1 = require("./retention.js");
Object.defineProperty(exports, "getRetentionRate", { enumerable: true, get: function () { return retention_js_1.getRetentionRate; } });
var performance_js_1 = require("./performance.js");
Object.defineProperty(exports, "computePerformance", { enumerable: true, get: function () { return performance_js_1.computePerformance; } });
Object.defineProperty(exports, "getChipCoefficient", { enumerable: true, get: function () { return performance_js_1.getChipCoefficient; } });
Object.defineProperty(exports, "getChipMultiCoreScore", { enumerable: true, get: function () { return performance_js_1.getChipMultiCoreScore; } });
Object.defineProperty(exports, "getCategoryFlagshipScore", { enumerable: true, get: function () { return performance_js_1.getCategoryFlagshipScore; } });
Object.defineProperty(exports, "getMemoryWeight", { enumerable: true, get: function () { return performance_js_1.getMemoryWeight; } });
Object.defineProperty(exports, "getStorageWeight", { enumerable: true, get: function () { return performance_js_1.getStorageWeight; } });
Object.defineProperty(exports, "getEffectiveR", { enumerable: true, get: function () { return performance_js_1.getEffectiveR; } });
var cost_js_1 = require("./cost.js");
Object.defineProperty(exports, "computeMonthlyCost", { enumerable: true, get: function () { return cost_js_1.computeMonthlyCost; } });
Object.defineProperty(exports, "computeMaintenanceCost", { enumerable: true, get: function () { return cost_js_1.computeMaintenanceCost; } });
Object.defineProperty(exports, "getCurrentNewPrice", { enumerable: true, get: function () { return cost_js_1.getCurrentNewPrice; } });
Object.defineProperty(exports, "getBuyPrice", { enumerable: true, get: function () { return cost_js_1.getBuyPrice; } });
var pareto_js_1 = require("./pareto.js");
Object.defineProperty(exports, "computeParetoFrontier", { enumerable: true, get: function () { return pareto_js_1.computeParetoFrontier; } });
var types_js_1 = require("./types.js");
Object.defineProperty(exports, "ConstantsValidationError", { enumerable: true, get: function () { return types_js_1.ConstantsValidationError; } });
//# sourceMappingURL=index.js.map