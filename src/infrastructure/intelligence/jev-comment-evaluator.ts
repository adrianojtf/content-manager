import type {
  CommentEvaluator,
  JevCommentAnalysisResult,
} from '../../application/ports/comment-evaluator.port';
import { IntelligenceProviderError } from '../../application/social/intelligence-provider-error';
import {
  readChoiceAnswer,
  readNoulAnswer,
  readScoreAnswer,
  summarizeConfidence,
} from './typesafe-system-one.answers';
import type { TypeSafeQuestion, TypeSafeSystemOneClient } from './typesafe-system-one.client';

const commentAnalysisSchemaVersion = 'typesafe-systemone-v1';

const sentimentOptions = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const;
const emotionOptions = ['JOY', 'CURIOSITY', 'FRUSTRATION', 'SADNESS', 'ANGER', 'SURPRISE', 'NEUTRAL', 'OTHER'] as const;
const intentOptions = ['QUESTION', 'PRAISE', 'COMPLAINT', 'SUGGESTION', 'CONTENT_REQUEST', 'REACTION', 'OTHER'] as const;
const topicOptions = ['CHARACTER', 'STORY', 'CONTENT', 'PRODUCTION', 'COMMUNITY', 'PLATFORM', 'OTHER'] as const;

const engagementLevels = [
  'No clear interest in continuing the discussion or requesting more content.',
  'A simple reaction or acknowledgement with limited interaction potential.',
  'A specific opinion, question, or feedback that supports a short exchange.',
  'Clear interest or a request for more content/another part; short wording still counts.',
  'A detailed or strong request likely to drive a broader conversation or continued viewing.',
] as const;

export class JevCommentEvaluator implements CommentEvaluator {
  constructor(private readonly systemOne: TypeSafeSystemOneClient) {}

  async evaluate(input: Parameters<CommentEvaluator['evaluate']>[0]): Promise<JevCommentAnalysisResult> {
    if (!input.comment.text?.trim()) {
      throw new IntelligenceProviderError('INTELLIGENCE_INPUT_INVALID');
    }

    const result = await this.systemOne.evaluate({
      state: {
        comment: { text: input.comment.text },
        publication: {
          platform: input.comment.platform,
          externalPublicationId: input.comment.externalPublicationId,
        },
      },
      questions: this.questions(),
    });

    const sentiment = readChoiceAnswer(result, 'sentiment', sentimentOptions);
    const emotion = readChoiceAnswer(result, 'emotion', emotionOptions);
    const intent = readChoiceAnswer(result, 'intent', intentOptions);
    const topic = readChoiceAnswer(result, 'topic', topicOptions);
    const spam = readNoulAnswer(result, 'spam');
    const toxicity = readNoulAnswer(result, 'toxicity');
    const engagement = readScoreAnswer(result, 'engagement', engagementLevels.length);
    const needsExternalFacts = readNoulAnswer(result, 'needs_external_facts');
    const requestsContinuation = readNoulAnswer(result, 'requests_continuation');
    const confidence = summarizeConfidence(
      sentiment.signal,
      emotion.signal,
      intent.signal,
      topic.signal,
      engagement,
    );

    return {
      sentiment: sentiment.value,
      emotion: emotion.value,
      intent: intent.value,
      topic: topic.value,
      entity: null,
      spamScore: spam.probability,
      toxicityScore: toxicity.probability,
      engagementValue: engagement.normalizedScore,
      continuationRequestProbability: requestsContinuation.probability,
      confidence,
      rationale: null,
      provider: 'JEV',
      model: result.model,
      schemaVersion: commentAnalysisSchemaVersion,
      signals: {
        sentiment: sentiment.signal,
        emotion: emotion.signal,
        intent: intent.signal,
        topic: topic.signal,
        spam,
        toxicity,
        engagement,
        needsExternalFacts,
        requestsContinuation,
      },
      usage: result.usage,
    };
  }

  private questions(): Readonly<Record<string, TypeSafeQuestion>> {
    return {
      sentiment: {
        type: 'choice',
        instructions: 'What sentiment does the comment in `comment.text` express?',
        criteria: {
          POSITIVE: 'The comment expresses positive approval, appreciation, or satisfaction.',
          NEUTRAL: 'The comment is mainly factual or does not express clear positive or negative sentiment.',
          NEGATIVE: 'The comment expresses dissatisfaction, criticism, or negative sentiment.',
        },
      },
      emotion: {
        type: 'choice',
        instructions: 'Which emotion is most clearly expressed by the comment in `comment.text`?',
        criteria: {
          JOY: 'Happiness, delight, or enthusiasm.',
          CURIOSITY: 'Interest or a desire to learn more.',
          FRUSTRATION: 'Annoyance or dissatisfaction without strong hostility.',
          SADNESS: 'Sorrow or disappointment.',
          ANGER: 'Strong anger or hostility.',
          SURPRISE: 'A clear expression of surprise or amazement.',
          NEUTRAL: 'No clear emotion is expressed.',
          OTHER: 'An identifiable emotion not covered by the other options.',
        },
      },
      intent: {
        type: 'choice',
        instructions: 'What is the primary intent of the comment in `comment.text`?',
        criteria: {
          QUESTION: 'The commenter asks for information or clarification.',
          PRAISE: 'The commenter primarily compliments the creator or content.',
          COMPLAINT: 'The commenter primarily reports a problem or dissatisfaction.',
          SUGGESTION: 'The commenter proposes an idea or change.',
          CONTENT_REQUEST: 'The commenter explicitly asks for another part, episode, or more content.',
          REACTION: 'The commenter reacts or shares an opinion without another primary intent.',
          OTHER: 'The primary intent does not fit the other options.',
        },
      },
      topic: {
        type: 'choice',
        instructions: 'Which broad topic best describes the subject of the comment?',
        criteria: {
          CHARACTER: 'A person, character, or participant featured in the content.',
          STORY: 'Plot, narrative, episode events, or storytelling.',
          CONTENT: 'The general subject or message of the content.',
          PRODUCTION: 'Audio, visuals, editing, presentation, or production quality.',
          COMMUNITY: 'The creator, audience, or interaction between them.',
          PLATFORM: 'The social platform, account, or a technical platform issue.',
          OTHER: 'A topic that does not fit the other options.',
        },
      },
      spam: {
        type: 'noul',
        instructions: 'Is the comment primarily unsolicited promotion, deceptive solicitation, or repetitive spam?',
        criteria: {
          true: 'The comment is primarily spam or unsolicited promotion.',
          false: 'The comment is not primarily spam or unsolicited promotion.',
        },
      },
      toxicity: {
        type: 'noul',
        instructions: 'Does the comment contain insulting, harassing, hateful, or threatening language?',
        criteria: {
          true: 'The comment contains insulting, harassing, hateful, or threatening language.',
          false: 'The comment does not contain such language.',
        },
      },
      engagement: {
        type: 'score',
        instructions: 'Estimate audience engagement potential from expressed interest, discussion value, or direct requests for more content. Do not score only by message length; this is not a count or prediction of actual likes or replies.',
        criteria: engagementLevels,
      },
      needs_external_facts: {
        type: 'noul',
        instructions: 'Would a helpful response require factual information that is not present in the supplied state?',
        criteria: {
          true: 'A helpful reply would require facts not supplied in the state.',
          false: 'A helpful reply can be written using only the supplied state.',
        },
      },
      requests_continuation: {
        type: 'noul',
        instructions: 'Does the comment explicitly request another part, episode, or continuation of the content?',
        criteria: {
          true: 'The comment explicitly asks for another part, episode, or continuation.',
          false: 'The comment does not explicitly request more or continuing content.',
        },
      },
    };
  }
}
