/**
 * Tool response factory utilities
 */

import { ErrorType, ToolResponse } from '../types.js';

export function createSuccess<T>(data: T, message?: string): ToolResponse<T> {
  return {
    success: true,
    data,
    message
  };
}

export function createError(type: ErrorType, message: string): ToolResponse<never> {
  return {
    success: false,
    error: { type, message }
  };
}

export function createNotFoundError(resource: string, id?: string): ToolResponse<never> {
  return createError(
    ErrorType.NOT_FOUND,
    id ? `${resource} not found: ${id}` : `${resource} not found`
  );
}

export function createInvalidParamsError(message: string): ToolResponse<never> {
  return createError(ErrorType.INVALID_PARAMS, message);
}

export function createInternalError(message: string): ToolResponse<never> {
  return createError(ErrorType.INTERNAL_ERROR, message);
}
