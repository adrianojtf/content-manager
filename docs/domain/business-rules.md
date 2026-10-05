# Business Rules

## Content

BR-CONTENT-001: Content must have a valid media reference before publication.

BR-CONTENT-002: A Content may have multiple independent Publications.

## Publication

BR-PUB-001: Each Publication belongs to one platform/account combination.

BR-PUB-002: Platform publication states are independent.

BR-PUB-003: Failure on one platform must not rollback successful publications elsewhere.

BR-PUB-004: Publication operations must be idempotent.

## Comments

BR-COMMENT-001: External comment identifiers must be preserved.

BR-COMMENT-002: Comment analysis is versionable.

BR-COMMENT-003: Low-confidence analysis must not trigger automatic external action.

## Responses

BR-RESPONSE-001: A generated response is a suggestion until approved by application policy.

BR-RESPONSE-002: A response must be evaluated before automatic publication.

BR-RESPONSE-003: Toxic, unsafe or low-confidence responses must require manual review or rejection.

BR-RESPONSE-004: The system must preserve the generated response and its evaluation.

## Intelligence

BR-AI-001: JEV is a provider, not the owner of business rules.

BR-AI-002: JEV receives prepared context and must not access persistence or social APIs.

BR-AI-003: AI outputs must be structured and validated.

BR-AI-004: Confidence and rationale must be preserved.

BR-AI-005: AI recommendations do not automatically mutate domain state.

## Audience Insights

BR-INSIGHT-001: Aggregate insights must reference the evidence period.

BR-INSIGHT-002: Recommendations must contain rationale.

BR-INSIGHT-003: Recommendations should distinguish observed evidence from AI inference.

## Platform Capability

BR-PLATFORM-001: The requested operation must be checked against platform capabilities before execution.

BR-PLATFORM-002: Unsupported capabilities must produce an explicit application result.
