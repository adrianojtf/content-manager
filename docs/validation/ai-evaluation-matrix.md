# AI Evaluation Matrix

| Scenario | Expected JEV Evaluation | Default Action |
|---|---|---|
| Positive reaction | Positive / reaction | Suggest reply |
| Simple question | Question / informational | Suggest reply |
| Next episode question | Next episode | Suggest reply |
| Praise | Positive / praise | Suggest reply |
| Complaint | Negative / complaint | Review |
| Toxicity | Toxic | Reject automatic reply |
| Spam | Spam | Ignore |
| Ambiguous | Low confidence | Manual review |
| Character reaction | Character/topic | Store insight |
| Recurring request | Request/topic | Feed audience insight |

## Important

The expected evaluation is a product test target, not a guarantee of a particular model output. Thresholds and prompts should be validated empirically.
