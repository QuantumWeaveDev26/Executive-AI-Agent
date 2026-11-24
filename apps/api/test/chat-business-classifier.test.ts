import { describe, it, expect } from 'vitest';
import { ChatBusinessClassifier } from '../src/services/chat-business-classifier.js';
import { QUANTUM_WEAVE_COMPANY_INFO } from '../src/services/quantum-weave-knowledge.js';

describe('ChatBusinessClassifier - Business-Only & Token Optimizer', () => {
  describe('Out-of-scope / Unrelated queries (Deterministic, zero LLM tokens)', () => {
    it('redirects trivia questions politely without calling model', () => {
      const result = ChatBusinessClassifier.classify('What is the capital of France?');
      expect(result.type).toBe('unrelated_out_of_scope');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('Quantum Weave AI');
      expect(result.replyText).toContain('digital marketing');
    });

    it('redirects joke requests politely without calling model', () => {
      const result = ChatBusinessClassifier.classify('Tell me a joke');
      expect(result.type).toBe('unrelated_out_of_scope');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('business growth and AI solutions');
    });

    it('redirects weather queries to seasonal business campaign planning', () => {
      const result = ChatBusinessClassifier.classify('What is the weather in Bangalore today?');
      expect(result.type).toBe('unrelated_out_of_scope');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('business solutions');
      expect(result.replyText).toContain('marketing campaigns');
    });

    it('redirects sports match questions', () => {
      const result = ChatBusinessClassifier.classify('Who won yesterday cricket match?');
      expect(result.type).toBe('unrelated_out_of_scope');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('sports-related marketing');
    });
  });

  describe('Technology Queries Framed for Business Automation', () => {
    it('explains Python strictly in the context of business automation', () => {
      const result = ChatBusinessClassifier.classify('What is Python?');
      expect(result.type).toBe('technology_query');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('Python');
      expect(result.replyText).toContain('automation');
      expect(result.replyText).toContain('Quantum Weave AI');
    });

    it('explains Artificial Intelligence in the context of business applications', () => {
      const result = ChatBusinessClassifier.classify('What is artificial intelligence?');
      expect(result.type).toBe('technology_query');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('Artificial Intelligence');
      expect(result.replyText).toContain('Quantum Weave AI');
    });
  });

  describe('Company and Services Queries', () => {
    it('provides full standard services list and Linktree URL', () => {
      const result = ChatBusinessClassifier.classify('What services do you provide?');
      expect(result.type).toBe('services_directory');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('1. Digital Marketing');
      expect(result.replyText).toContain('3. WhatsApp Automation');
      expect(result.replyText).toContain(QUANTUM_WEAVE_COMPANY_INFO.linktreeUrl);
    });

    it('provides company overview with official Linktree link', () => {
      const result = ChatBusinessClassifier.classify('What does Quantum Weave do?');
      expect(result.type).toBe('company_overview');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('Quantum Weave AI helps businesses grow');
      expect(result.replyText).toContain(QUANTUM_WEAVE_COMPANY_INFO.linktreeUrl);
    });

    it('mentions founders only when explicitly asked', () => {
      const result = ChatBusinessClassifier.classify('Who founded Quantum Weave company?');
      expect(result.type).toBe('company_overview');
      expect(result.deterministic).toBe(true);
      expect(result.replyText).toContain('Kaaranji Shreedhar and Vishak B');
    });
  });

  describe('Legitimate Business & Document Queries', () => {
    it('marks message as document_analysis when attachments are present', () => {
      const result = ChatBusinessClassifier.classify('Summarize this proposal', true);
      expect(result.type).toBe('document_analysis');
      expect(result.deterministic).toBe(false);
    });

    it('routes open-ended business inquiries to the model with relevant services', () => {
      const result = ChatBusinessClassifier.classify('How can we increase sales using social media marketing?');
      expect(result.type).toBe('business_inquiry');
      expect(result.deterministic).toBe(false);
      expect(result.relevantServices).toBeDefined();
      expect(result.relevantServices?.length).toBeGreaterThan(0);
      expect(result.relevantServices?.some((s) => s.name.includes('Digital Marketing'))).toBe(true);
    });
  });
});
