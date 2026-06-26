import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * Standard API rate limiter:
 * 1000 requests per minute per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
});

/**
 * Strict rate limiter for auth endpoints (signup, signin):
 * 10 requests per minute per IP — prevents brute-force / credential stuffing
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again in a minute." },
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
});

/**
 * Moderate rate limiter for file uploads:
 * 20 requests per minute per IP — prevents large upload floods
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many upload requests. Please wait." },
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
});

/**
 * Loose rate limiter for public NOA endpoints:
 * 30 requests per minute per IP
 */
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  keyGenerator: (req) => ipKeyGenerator(req.ip || "unknown"),
});
