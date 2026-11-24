import { type Static } from '@sinclair/typebox';
export declare const PhoneCallTurnSchema: import("@sinclair/typebox").TObject<{
    sequence: import("@sinclair/typebox").TInteger;
    speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">, import("@sinclair/typebox").TLiteral<"unknown">]>;
    text: import("@sinclair/typebox").TString;
    source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_transcript">, import("@sinclair/typebox").TLiteral<"provider_english_translation">]>;
    attribution: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_labelled">, import("@sinclair/typebox").TLiteral<"uncertain">]>;
}>;
export type PhoneCallTurn = Static<typeof PhoneCallTurnSchema>;
export declare const PhoneCallEvidenceSchema: import("@sinclair/typebox").TObject<{
    version: import("@sinclair/typebox").TLiteral<1>;
    turns: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        sequence: import("@sinclair/typebox").TInteger;
        speaker: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"thaara">, import("@sinclair/typebox").TLiteral<"customer">, import("@sinclair/typebox").TLiteral<"unknown">]>;
        text: import("@sinclair/typebox").TString;
        source: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_transcript">, import("@sinclair/typebox").TLiteral<"provider_english_translation">]>;
        attribution: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"provider_labelled">, import("@sinclair/typebox").TLiteral<"uncertain">]>;
    }>>;
    truncated: import("@sinclair/typebox").TBoolean;
    verified: import("@sinclair/typebox").TLiteral<false>;
    taskOutcome: import("@sinclair/typebox").TLiteral<"not_independently_verified">;
}>;
export type PhoneCallEvidence = Static<typeof PhoneCallEvidenceSchema>;
export declare const isPhoneCallEvidence: (v: unknown) => v is PhoneCallEvidence;
/** Extractive only: no dialogue, dates, commitments or agreement are generated. */
export declare function capturePhoneCallEvidence(messages: readonly {
    role: unknown;
    text: unknown;
}[], source: PhoneCallTurn['source']): PhoneCallEvidence;
/** Adjacency is correspondence, not proof that an answer resolves the question. Unknown turns break the pair. */
export declare function phoneCallExchanges(evidence: PhoneCallEvidence): {
    question: {
        sequence: number;
        speaker: "thaara" | "customer" | "unknown";
        text: string;
        source: "provider_transcript" | "provider_english_translation";
        attribution: "provider_labelled" | "uncertain";
    };
    answer: {
        sequence: number;
        speaker: "thaara" | "customer" | "unknown";
        text: string;
        source: "provider_transcript" | "provider_english_translation";
        attribution: "provider_labelled" | "uncertain";
    };
}[];
/** Evidence excerpts, not inferred promises or a model-generated interpretation. */
export declare function phoneCallHighlights(evidence: PhoneCallEvidence): {
    outcome: string;
    blockers: {
        sequence: number;
        speaker: "thaara" | "customer" | "unknown";
        text: string;
        source: "provider_transcript" | "provider_english_translation";
        attribution: "provider_labelled" | "uncertain";
    }[];
    timeframes: {
        sequence: number;
        speaker: "thaara" | "customer" | "unknown";
        text: string;
        source: "provider_transcript" | "provider_english_translation";
        attribution: "provider_labelled" | "uncertain";
    }[];
};
//# sourceMappingURL=phone-call-evidence.d.ts.map