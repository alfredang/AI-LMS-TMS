---
layout: default
title: Developer User Guide
---

# Developer User Guide

Complete guide for course developers using AI-LMS-TMS.

[Back to Home](./)

---

## Overview

As a **Developer** (Course Developer), you are responsible for creating and maintaining course content. This includes designing course structures, writing learning materials, creating assessments, and using AI-powered tools to generate professional training content efficiently.

---

## Getting Started

### Logging In

1. Navigate to the AI-LMS-TMS platform
2. Enter your registered email address
3. Click **"Send OTP"** to receive a verification code
4. Enter the 6-digit OTP sent to your email
5. Click **"Verify & Login"**

### First-Time Profile Setup

Complete your developer profile:

1. Click on your profile icon
2. Select **"Profile"**
3. Fill in your professional details:
   - Full Name
   - Contact Information
   - Specialization/Expertise
   - Qualifications
4. Click **"Save"**

---

## Dashboard Overview

Your developer dashboard displays:

- **Course Management**: All courses in the system
- **Recent Activity**: Recently edited courses
- **Quick Actions**: Create new course, access GenAI tools
- **Statistics**: Course count and content status

---

## Navigation

### Main Menu

| Menu Item | Description |
|-----------|-------------|
| **Home** | Developer dashboard |
| **Courses** | Browse and manage all courses |
| **Developer GenAI Authoring** | AI-powered content creation tools |

### Profile Menu

Access via your profile icon:
- **Profile**: View and update your information
- **Help & Support**: Get assistance
- **Logout**: Sign out

---

## Course Management

### Viewing Courses

1. Click **"Courses"** in navigation
2. Browse all course templates in the system
3. Use search and filters:
   - Course name
   - Course type (WSQ, IBF, General)
   - Status (Draft, Published)

### Course Structure

Each course consists of:

```
Course
├── Course Information (metadata, description, objectives)
├── Learning Units (chapters/modules)
│   ├── Subtopic 1
│   ├── Subtopic 2
│   └── Subtopic 3
├── Course Materials (guides, slides, resources)
└── Assessments (written, oral, practical)
```

---

## Creating a New Course

### Step 1: Basic Information

1. Click **"Create New Course"**
2. Enter course details:

| Field | Description |
|-------|-------------|
| **Course Title** | Clear, descriptive name |
| **Course Code** | Unique identifier (e.g., WSQ-001) |
| **Description** | Overview of the course |
| **Course Type** | WSQ, IBF, or General |
| **Mode of Learning** | Classroom, Online, or Blended |
| **Duration** | Total hours |
| **Language** | Delivery language |

### Step 2: Learning Outcomes

Define what learners will achieve:

1. Click **"Learning Outcomes"** tab
2. Add outcomes using the **"Add Outcome"** button
3. Write clear, measurable outcomes:
   - Start with action verbs (Explain, Demonstrate, Apply, etc.)
   - Be specific and measurable
   - Align with assessment criteria

**Example:**
> "Upon completion, learners will be able to demonstrate effective communication techniques in a professional setting."

### Step 3: Create Learning Units

1. Click **"Learning Units"** tab
2. Click **"Add Learning Unit"**
3. Enter unit details:
   - Unit title
   - Unit description
   - Order/sequence number

### Step 4: Add Subtopics

For each learning unit:

1. Click on the unit to expand
2. Click **"Add Subtopic"**
3. Enter subtopic information:
   - Title
   - Content/description
   - Duration
   - Resources
4. Repeat for all subtopics

### Step 5: Upload Course Materials

1. Go to **"Materials"** tab
2. Upload documents:

| Material | Format | Purpose |
|----------|--------|---------|
| **Learner Guide** | PDF | Student reference handbook |
| **Facilitator Guide** | PDF | Trainer instructions |
| **Slides** | PPTX/PDF | Presentation materials |
| **Lesson Plan** | PDF | Teaching schedule and activities |
| **Assessment Plan** | PDF | Grading criteria and rubrics |

### Step 6: Create Assessments

1. Go to **"Assessments"** tab
2. Click **"Add Assessment"**
3. Configure assessment:
   - Name and description
   - Category (Written, Oral, Practical)
   - Instructions for learners
   - Grading criteria
   - Maximum score

### Step 7: Review and Publish

1. Review all sections
2. Ensure completeness
3. Click **"Publish"** when ready

---

## Editing Existing Courses

### Accessing a Course for Editing

1. Go to **"Courses"**
2. Find the course to edit
3. Click on the course card
4. Click **"Edit"** button

### Editing Course Information

1. Click **"Course Info"** tab
2. Modify fields as needed:
   - Update description
   - Change duration
   - Modify learning outcomes
3. Click **"Save Changes"**

### Editing Learning Units

1. Go to **"Learning Units"** tab
2. Click on a unit to expand
3. Make changes:
   - Edit unit details
   - Add/remove subtopics
   - Reorder content
4. Save after each change

### Updating Materials

1. Go to **"Materials"** tab
2. To replace: Click **"Replace"** and upload new file
3. To remove: Click the delete icon
4. To add: Upload new materials

### Managing Assessments

1. Go to **"Assessments"** tab
2. Edit existing assessments:
   - Modify questions/instructions
   - Update grading criteria
   - Change due dates
3. Add new assessments as needed

---

## Developer GenAI Authoring

### Overview

The AI-powered authoring suite helps you create professional course content quickly. Generate everything from learning outcomes to complete assessments.

### Accessing GenAI Tools

1. Click **"Developer GenAI Authoring"** in navigation
2. Choose the content type to generate
3. Configure parameters
4. Generate and refine content

### Available Content Generators

#### 1. Learning Outcomes Generator

Generate measurable learning outcomes:

1. Enter course topic/title
2. Specify competency level (Foundational, Intermediate, Advanced)
3. Set number of outcomes needed
4. Click **"Generate"**
5. Review and customize outputs

#### 2. Lesson Plan Generator

Create structured teaching plans:

**Inputs:**
- Topic/subject
- Duration
- Learning objectives
- Target audience level

**Output:**
- Timed activities
- Teaching methods
- Resources needed
- Assessment checkpoints

#### 3. Case Study Generator

Generate realistic business scenarios:

**Inputs:**
- Industry/context
- Key concepts to cover
- Difficulty level
- Learning objectives

**Output:**
- Background scenario
- Challenge description
- Discussion questions
- Suggested solutions

#### 4. Role Play Scenario Generator

Create interactive exercises:

**Inputs:**
- Context/setting
- Skills to practice
- Number of roles
- Complexity level

**Output:**
- Scenario description
- Character briefs
- Objectives per role
- Debriefing questions

#### 5. Assessment Generator

Generate assessments by type:

**Written Assessments:**
- Essay questions
- Short answer questions
- Case analysis prompts

**Oral Assessments:**
- Presentation topics
- Discussion questions
- Verbal Q&A scenarios

**Practical Assessments:**
- Demonstration tasks
- Project briefs
- Skills checklists

#### 6. Mind Map Generator

Visual concept organizers:

**Inputs:**
- Central topic
- Key concepts to cover
- Depth level

**Output:**
- Hierarchical concept structure
- Relationships between ideas
- Visual representation

#### 7. Discussion Topics Generator

Facilitation resources:

**Inputs:**
- Subject area
- Learning objectives
- Group size

**Output:**
- Opening questions
- Follow-up prompts
- Debate topics
- Reflection questions

### Best Practices for GenAI

1. **Be Specific**: Detailed inputs produce better outputs
2. **Iterate**: Generate multiple versions
3. **Review Thoroughly**: Always verify accuracy
4. **Customize**: Adapt to your context
5. **Combine**: Mix AI content with your expertise

---

## Publishing Assessments

### Publishing Process

1. Go to course > **"Assessments"** tab
2. Find the assessment to publish
3. Toggle the **"Published"** switch
4. Confirm publication

### Publication States

| State | Description | Learner Access |
|-------|-------------|----------------|
| **Draft** | Under development | Not visible |
| **Published** | Ready for learners | Visible and accessible |
| **Unpublished** | Temporarily hidden | Not visible |

### Publication Tips

- Review assessment thoroughly before publishing
- Ensure instructions are clear
- Verify grading criteria is complete
- Set appropriate deadlines

---

## Course Materials Management

### Supported File Types

| Type | Extensions | Max Size |
|------|------------|----------|
| Documents | PDF, DOCX | 10MB |
| Presentations | PPTX, PDF | 20MB |
| Images | PNG, JPG, GIF | 5MB |
| Videos | MP4, MOV | 100MB |

### Organizing Materials

1. Use clear, descriptive filenames
2. Version your documents (v1, v2, etc.)
3. Organize by learning unit when possible
4. Keep materials up to date

### Replacing Materials

1. Click **"Replace"** on existing material
2. Upload the new version
3. The old version is automatically replaced
4. Learners see only the latest version

---

## Course Image Management

### Updating Course Image

1. Go to course details
2. Click on the course image
3. Click **"Change Image"**
4. Upload new image (recommended: 800x400px)
5. Image updates immediately

### Image Guidelines

- Use high-quality, relevant images
- Recommended size: 800x400 pixels
- Supported formats: PNG, JPG
- Keep file size under 2MB

---

## Profile Management

### Updating Your Profile

1. Click profile icon > **"Profile"**
2. Edit your information:
   - Personal details
   - Expertise areas
   - Qualifications
3. Click **"Save"**

---

## AI Chatbot Assistant

### Using the Chatbot

The AI assistant helps with:
- Content development questions
- Platform navigation
- Best practices guidance
- Quick research

### Access

1. Click the **chat icon** (bottom-right)
2. Type your question
3. Get instant responses

---

## Workflow Best Practices

### Course Development Workflow

1. **Plan**: Define objectives and structure
2. **Create**: Build content using GenAI tools
3. **Review**: Verify accuracy and completeness
4. **Upload**: Add all materials
5. **Test**: Review from learner perspective
6. **Publish**: Make available to trainers

### Content Quality Checklist

- [ ] Learning outcomes are measurable
- [ ] Content aligns with outcomes
- [ ] Materials are complete and organized
- [ ] Assessments match learning objectives
- [ ] Instructions are clear
- [ ] Grading criteria is defined
- [ ] All links and resources work

---

## Troubleshooting

### Common Issues

**Can't create a new course?**
- Verify you have developer permissions
- Check all required fields are filled
- Contact administrator if issues persist

**GenAI not generating content?**
- Ensure inputs are detailed enough
- Try different parameters
- Check internet connection

**File upload failing?**
- Check file size limits
- Verify file format is supported
- Try a smaller file

**Changes not saving?**
- Check internet connection
- Refresh the page
- Try saving smaller sections

---

## Quick Reference

### Content Types Summary

| Type | When to Use |
|------|------------|
| **Learning Outcomes** | Start of course development |
| **Lesson Plans** | Structuring delivery |
| **Case Studies** | Real-world application |
| **Role Plays** | Interactive learning |
| **Assessments** | Measuring competency |
| **Mind Maps** | Visual learners |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close modal |
| `Enter` | Confirm |
| `Ctrl+S` | Save (in editors) |

---

[Back to Home](./)
