# Cambridge Progress Tracker — Development Specification

> Source of truth for all backend development decisions. Before adding any feature, endpoint, model, or service, verify it is listed here. If it is not, do not implement it without explicit user approval.

---

## 1. Product Overview

**Name:** Cambridge Progress Tracker / ExamFlow  
**Type:** Web (and future mobile) app for Cambridge B2 First / FCE preparation  
**Core value:** Convert daily study into measurable data — detect weaknesses, improve weekly plan, compare progress via mocks.

**Differentiator:**

> "Help users prepare Cambridge by measuring progress per skill, activity and mock, detecting weaknesses and generating a personalized practice plan."

---

## 2. Target Users

| Role               | Description                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Student (MVP)      | Registers, sets goal, manages calendar, completes activities, records scores, uploads evidence, reviews progress |
| Advanced / Premium | Automatic plans, AI recommendations, writing/speaking analysis, PDF exports                                      |
| Teacher / Tutor    | Future phase — review student progress, evidence, mocks, weakness by skill                                       |

---

## 3. Skills (canonical list — do not add or rename)

```
Reading
Listening
Writing
Speaking
Use of English
Vocabulary
Grammar
```

These are the **only** valid skill values throughout the entire system.

---

## 4. Modules (build order follows phases)

| Module             | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Auth               | Register, login, profile                                                                 |
| Dashboard          | Weekly summary, completed activities, avg score, strongest/weakest skill, streak         |
| Weekly Calendar    | Editable Mon–Sun view, activities per day, color by skill, drag-drop, repeat, status     |
| Activity Library   | Predefined catalog of exercises by skill and exam part                                   |
| Score Registration | Flexible score capture per activity type (correct answers, %, rubrics, time, difficulty) |
| Evidence           | Upload images, PDFs, audio, external links, personal notes                               |
| Mocks              | Full or partial mock exam registration, score per section, historical comparison         |
| Progress Charts    | Evolution by skill, specific activity, week, month, mock                                 |
| Recommendations    | Rule-based weakness detection → suggested activities (MVP); AI in later phase            |
| Goals              | Target exam, target date, target score, current level, available days/week, daily time   |
| Resources          | Personal library of PDFs, videos, links, writing templates, vocabulary, phrasal verbs    |

---

## 5. Data Model (canonical entities)

Only these entities are approved for Phase 1. Do not create tables/collections outside this list without approval.

```
User
Skill
ActivityType
WeeklyPlan
PlanDay
Activity
ActivityScore
EvidenceFile
MockTest
MockSectionScore
Goal
StudySession
Resource
Recommendation
```

---

## 6. Activity Library — Exercises by Skill

### Use of English

- Part 1: Multiple-choice cloze
- Part 2: Open cloze
- Part 3: Word formation
- Part 4: Key word transformation

### Reading

- Part 1: Multiple choice
- Part 5: Multiple choice text
- Part 6: Gapped text
- Part 7: Multiple matching

### Listening

- Part 1: Multiple choice
- Part 2: Sentence completion
- Part 3: Multiple matching
- Part 4: Multiple choice

### Writing

- Essay
- Article
- Review
- Report
- Email/Letter

### Speaking

- Part 1: Interview
- Part 2: Long turn
- Part 3: Collaborative task
- Part 4: Discussion

---

## 7. Score Formats by Activity Type

### Reading / Use of English

```
correctAnswers: number
totalAnswers: number
percentage: number        // auto-calculated
timeSpent: number         // minutes
difficulty: 'easy' | 'medium' | 'hard'
```

### Writing (rubric)

```
content: 1–5
communicativeAchievement: 1–5
organization: 1–5
language: 1–5
total: number             // sum, max 20
```

### Speaking (rubric)

```
fluency: 1–10
pronunciation: 1–10
vocabulary: 1–10
grammar: 1–10
interaction: 1–10
```

---

## 8. Mock Exam Structure

Fields required per mock:

```
name: string
date: Date
readingScore: number       // out of 30
useOfEnglishScore: number  // out of 28
writingScore: number       // out of 40
listeningScore: number     // out of 30
speakingScore: number      // out of 40
estimatedLevel: string     // e.g. "B1+/B2"
cambridgeScaleScore: number
notes: string
evidenceFileId?: string
```

---

## 9. Weakness Detection Rules (MVP — no AI)

| Condition     | Action                                                      |
| ------------- | ----------------------------------------------------------- |
| Score < 60%   | Mark as weakness → recommend 2x/week                        |
| Score 60%–75% | Mark as in-progress → maintenance practice                  |
| Score > 75%   | Mark as strong → reduce frequency if other weaknesses exist |

These are the **only** recommendation rules for Phase 1. Do not implement ML or AI calls in MVP.

---

## 10. Functional Requirements

| ID    | Requirement                                                                   |
| ----- | ----------------------------------------------------------------------------- |
| RF-01 | User can register and log in                                                  |
| RF-02 | User can create, edit and delete activities in the weekly calendar            |
| RF-03 | User can assign skill, type, difficulty, priority and duration to an activity |
| RF-04 | User can mark an activity as completed                                        |
| RF-05 | User can register score, percentage, notes and time spent                     |
| RF-06 | User can upload evidence: image, PDF, audio                                   |
| RF-07 | User can view history of completed activities                                 |
| RF-08 | User can register full or partial mock exams                                  |
| RF-09 | System shows charts by skill, activity and mock                               |
| RF-10 | System detects weaknesses using score-based rules                             |

---

## 11. Non-Functional Requirements

- Responsive, clean UI (web-first, mobile-ready)
- Secure file/evidence persistence
- JWT authentication (or external provider)
- Modular architecture: web and mobile versions must share business logic
- Export reports to PDF/CSV — Phase 2 only, not MVP
- Designed to evolve toward AI, teacher mode, monetization

---

## 12. Phase Roadmap

### Phase 1 — Strong MVP (current)

Login/Register · Dashboard · Editable weekly calendar · Create activities · Register scores · Upload evidence · History · Skill charts · Register full mocks

### Phase 2 — Automation

Auto recommendations · Auto weekly planner · Resource library · PDF report export · Audio upload for speaking

### Phase 3 — AI & Scale

AI writing analysis · AI speaking feedback · Tutor marketplace · Teacher/student mode · Study groups

---

## 13. Development Rules

These rules apply to ALL code produced for this project:

1. **Skills are a fixed enum.** Never hardcode skill names as free strings; always reference the canonical list in Section 3.
2. **No new entities without approval.** The data model in Section 5 is the approved set for Phase 1.
3. **No AI/ML in Phase 1.** Recommendations use rule-based logic only (Section 9).
4. **Score format is activity-type-specific.** Use the formats in Section 7; do not create a generic single-number score for Writing or Speaking.
5. **Mock scores have fixed section maximums.** Reading/30, Use of English/28, Writing/40, Listening/30, Speaking/40.
6. **No PDF/CSV export in MVP.** That feature belongs to Phase 2.
7. **No teacher/tutor endpoints in Phase 1.** That is a Phase 3 feature.
8. **Auth must use JWT.** No session cookies unless explicitly approved.
9. **Architecture must be modular.** Each module (activities, mocks, scores, evidence, dashboard) is an isolated service/controller/repository — no cross-module direct DB calls.
10. **File storage for evidence is required by MVP.** Image, PDF, audio upload support must be included in Phase 1.
11. **All endpoints follow REST conventions** already established in the codebase (Serverless + Lambda pattern).
12. **Do not add monetization logic to Phase 1.** Freemium, premium checks, payment hooks belong to a future phase.

---

## 14. Dashboard Response Shape (reference)

```json
{
  "weeklyActivities": { "completed": 12, "planned": 18 },
  "studyMinutes": 420,
  "weeklyAvgScore": 68.5,
  "strongestSkill": { "skill": "Reading", "score": 78 },
  "weakestSkill": { "skill": "Listening", "score": 54 },
  "studyStreak": 5,
  "lastMock": { "name": "FCE Mock Test 01", "date": "2026-05-13", "cambridgeScale": 160 },
  "monthlyProgressBySkill": [
    { "skill": "Reading", "scores": [65, 70, 74, 78] },
    { "skill": "Listening", "scores": [45, 48, 52, 54] }
  ]
}
```

---

## 15. Activity Object Shape (reference)

```json
{
  "id": "uuid",
  "name": "Practice Part 2 Reading",
  "skill": "Reading",
  "activityTypeId": "uuid",
  "dayOfWeek": "Wednesday",
  "targetScore": 70,
  "priority": "medium",
  "estimatedDuration": 45,
  "completed": true,
  "realScore": 64,
  "notes": "Problems with vocabulary and time management.",
  "evidenceFileId": "uuid",
  "weeklyPlanId": "uuid"
}
```

---

_Document version: 1.0 — Generated from `documentacion_app_cambridge_tracker.pdf`_
