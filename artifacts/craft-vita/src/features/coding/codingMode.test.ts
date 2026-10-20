import { describe, expect, it } from "vitest";
import {
  CODING_CONFIDENCE_THRESHOLD,
  detectCodingQuestion,
  isCodingQuestion,
} from "./codingQuestionDetector";
import {
  CODING_ANSWER_CONTRACT,
  CODING_ANSWER_MODE,
  routeAnalyzeScreenCodingMode,
} from "./analyzeScreenCodingRoute";

const CODING_QUESTIONS = [
  "What is the time complexity of this solution?",
  "Can you implement a function that reverses a linked list?",
  "Write a function to check whether a string is a palindrome.",
  "Please debug this code — it throws on an empty array.",
  "How would you optimize this SQL query?",
  "Design a URL shortener.",
  "Design a rate limiter.",
  "Given an array of integers, return the indices of two numbers that sum to the target.",
  "What's the output of this code?",
  "Explain the algorithm and its Big-O complexity.",
  "Write a SQL query to find the second highest salary.",
  "This is a LeetCode medium — implement it in Python.",
];

const NON_CODING_QUESTIONS = [
  "Tell me about yourself.",
  "Why do you want to work here?",
  "Describe a time you led a team through a difficult project.",
  "What are your salary expectations?",
  "How do you handle conflict with a colleague?",
  "What is your greatest strength?",
  "Explain the difference between REST and GraphQL.",
  "Tell me about a time you optimized a business process.",
  "",
  "   ",
];

describe("coding-question detector", () => {
  it.each(CODING_QUESTIONS)("flags coding question: %s", (question) => {
    const detection = detectCodingQuestion(question);
    expect(detection.isCoding, `${question} -> ${JSON.stringify(detection)}`).toBe(true);
    expect(detection.confidence).toBeGreaterThanOrEqual(CODING_CONFIDENCE_THRESHOLD);
    expect(detection.signals.length).toBeGreaterThan(0);
  });

  it.each(NON_CODING_QUESTIONS)("does not flag non-coding question: %s", (question) => {
    expect(isCodingQuestion(question)).toBe(false);
  });

  it("is deterministic and pure", () => {
    const question = "Implement a binary search in JavaScript.";
    expect(detectCodingQuestion(question)).toEqual(detectCodingQuestion(question));
  });

  it("returns zero confidence for empty input", () => {
    expect(detectCodingQuestion("")).toEqual({
      isCoding: false,
      confidence: 0,
      signals: [],
    });
  });

  it("reports the signals that fired for tuning", () => {
    const detection = detectCodingQuestion(
      "Implement a function and state the time complexity.",
    );
    expect(detection.signals).toEqual(expect.arrayContaining(["implement", "complexity"]));
    expect(detection.confidence).toBeGreaterThan(0.9);
  });
});

describe("structured coding answer contract", () => {
  it("requires approach, complexity and edge cases", () => {
    expect(CODING_ANSWER_CONTRACT).toContain("**Approach**");
    expect(CODING_ANSWER_CONTRACT).toContain("**Complexity**");
    expect(CODING_ANSWER_CONTRACT).toContain("**Edge cases**");
    expect(CODING_ANSWER_CONTRACT).toContain("Big-O");
    expect(CODING_ANSWER_CONTRACT).toContain("fenced code block");
  });

  it("routes a coding Analyze Screen request to code_required", () => {
    const route = routeAnalyzeScreenCodingMode({
      question: "Implement two sum and state the complexity.",
      transcript: "The interviewer shared a coding task on screen.",
    });
    expect(route.answerMode).toBe(CODING_ANSWER_MODE);
    expect(route.answerMode).toBe("code_required");
    expect(route.detection.isCoding).toBe(true);
    expect(route.promptAddendum).toBe(CODING_ANSWER_CONTRACT);
  });

  it("keeps non-coding Analyze Screen requests on auto", () => {
    const route = routeAnalyzeScreenCodingMode({
      question: "Tell me about yourself.",
      transcript: "Behavioral interview.",
    });
    expect(route.answerMode).toBe("auto");
    expect(route.promptAddendum).toBeUndefined();
  });

  it("can detect coding from the transcript alone when the question is empty", () => {
    const route = routeAnalyzeScreenCodingMode({
      transcript: "Given a string, return the longest palindromic substring.",
    });
    expect(route.answerMode).toBe("code_required");
  });
});
