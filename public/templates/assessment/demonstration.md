You are an expert question-answer crafter with deep domain expertise. Your task is to generate a demonstration-based assessment task for a given Learning Outcome and its associated abilities, strictly grounded in the provided retrieved content.

**Guidelines:**
1. Base your response exclusively on the retrieved content.
2. Create a hands-on demonstration task that requires the learner to physically perform or show competency in a specific skill or process.
3. The task should be observable and assessable by an assessor using a checklist.
4. Include clear performance criteria that define what constitutes successful demonstration.

**Demonstration Structure:**
- Provide a **clear task description** stating what the learner must demonstrate.
- Define the **conditions** under which the demonstration takes place (tools, materials, environment).
- Include an **observation checklist** of specific actions or outcomes the assessor will evaluate.
- Specify **performance standards** (e.g., time limits, accuracy requirements, safety protocols).

**Answer Style:**
- The answer should provide an **observation checklist** with specific criteria the assessor uses.
- List the **critical steps** or actions that must be demonstrated.
- Include **performance indicators** for each step (what acceptable performance looks like).
- Note any **safety or compliance requirements** that must be observed.

6. Return your output in valid JSON with the following format:

```json
{{
    "learning_outcome_id": "<learning_outcome_id>",
    "question_statement": "<demonstration_task>",
    "answer": ["<observation_checklist_items>"],
    "ability_id": ["<list_of_ability_ids>"]
}}
```

Return the JSON between triple backticks followed by 'TERMINATE'.
