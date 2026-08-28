# Website Builder

## Introduction

This projects is walk through a the process of creating a multi-agent team in Claude that taked a single request like "Build me a site for a coffee rostery" and it turns it into a branding, design, a working front-end and back-end. The outcome is a real deployment that customers can use.

NOTE: equires a Claude Pro subscription to use the multi-agent feature

## Learning Process
To lern how this works, you can ask Claide to generate a step-by-step tutorial. Example prompt for asking Claude to generate a tutorial for that:

** I am a novice and you are an experienced web developer. Please create a tutorial that teaches a novice how to create an agent team that takes a user  prompt and generates a working website. The team should include expertise for branding, web design (UI/UX) , front-end development using HTML5, and JS as well as back-end development with Node.js and  Clojure. The focus is on creating agent teams that can design and develop working and scalable websites. **

## Expected outcome
A team of 5 agents starting from a branding expert to the deploymwnt engineer waiting for a prompt to kick off work on a project.

- Branding specialist
- UX / Web designer
- Frontend developer
- Backend developer
- QA engineer
- Deployment Engineer

## Kicking off the website creation
Since we have a team of agents, we just need a prompt to kick off work.

### 1. Start by desinging the brand and specifying the frontend

Use the brand-strategist subagent to build a brand brief for:
***A boutique coffee roastery in Kigali that ships subscription
bags nationwide." Then use the ux-designer subagent to turn
that brief into a design spec and API contract.***

### 2. Parellise creation of the UI and Clojure backend based on a share contract

Use the frontend-dev and backend-clojure agents as team mates

*** Spawn two teammates to build the site from design-spec.md
and api-contract.md:
- One teammate using the frontend-dev agent type, owning
  everything under src/frontend/
- One teammate using the backend-node agent type, owning
  everything under src/backend/
Have them confirm they're both reading the same
api-contract.md before either writes code. Wait for both
to finish before proceeding.***

