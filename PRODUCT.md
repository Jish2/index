# People Search on X — Product Overview

## 1. Summary  
This product is a **public, consumer-facing search engine for people on X**.  
It allows anyone to enter a natural-language query and instantly discover relevant individuals from a curated universe of X users. Users can be found based on **who they are**, **what they talk about**, **their social presence**, and **their interests or expertise**.

The product is designed to support:
- Recruiting and talent discovery  
- Professional networking  
- Finding collaborators or cofounders  
- Interest-based friend discovery  
- Social exploration and user self-search (“find yourself on the graph”)

It bridges the gap between X’s raw content and real human discovery.

---

## 2. Core Value Proposition

### **For general users**
- Discover people who share your interests, passions, or worldview.  
- Find creators, technologists, founders, and communities you didn’t know existed.  
- Search for people like: “AI engineers in NYC,” “artists who tweet about surrealism,” or “early-stage founders in climate tech.”

### **For professionals**
- Identify domain experts, thought leaders, and niche specialists.  
- See who is influential in a certain field or topic.  
- Find collaborators, mentors, or peers with similar careers.

### **For recruiters**
- Surface highly relevant candidates based on skills, topics, or industry.  
- Search for people by role (“ML researcher”), interest (“Kubernetes”), or background (“ex-startup founder”).  
- Quickly understand why someone is relevant through short profile explanations.

### **For creators & founders**
- Understand how they’re perceived online.  
- Ensure they can be found by people looking for their expertise.  
- Expand their reach to audiences searching for their topics.

---

## 3. User Personas

### **1. The Explorer**
Wants to meet people with similar interests, find new communities, or discover niche creators.  
Example intent: *“Show me people into indie game dev in Toronto.”*

### **2. The Recruiter**
Looking to identify strong potential hires without sifting through resumes.  
Example intent: *“Find Rust engineers who talk about embedded systems.”*

### **3. The Founder / Builder**
Searching for cofounders, early contributors, or domain experts.  
Example intent: *“Who is working on open-source LLM tooling?”*

### **4. The Creator / Influencer**
Wants to understand how they appear in search, expand exposure, and identify similar creators.  
Example intent: *“Who else is creating content about digital minimalism?”*

### **5. The Networker**
Wants to deepen their personal graph in a meaningful way.  
Example intent: *“People in SF who care about climate and hardware.”*

---

## 4. Core Product Features

### **1. Natural Language Search**
Users can type anything—descriptions, goals, characteristics—and the system interprets the intent.  
Examples:
- “Female founders in Europe”
- “People who tweet about robotics and UAVs”
- “Designers obsessed with clean typography”
- “Friends I might vibe with in NYC”

### **2. Multi-Dimensional Matching**
Search results consider multiple dimensions:
- Profile identity (bio, roles, self-description)  
- User interests/topics  
- Tweet content patterns  
- Followers/influence  
- Location (if publicly provided)  
- Expertise inferred from public posting behavior  
- Shared characteristics across communities  

### **3. Relevance Explanations**
Each result includes a short, human-readable reason explaining why the person matches the query.  
This makes search transparent, intuitive, and trustworthy.

### **4. Topic & Role Understanding**
The system recognizes roles and categories—“founder,” “VC,” “engineer,” “artist,” “researcher”—as well as thematic topics such as AI, fashion, gaming, biotech, etc.

### **5. Personalized Discovery**
Users can search for:
- Similar people (“people like me”)  
- Adjacent communities  
- Potential collaborators or friends  
- Specialists or micro-influencers in niche fields  

### **6. Self-Search**
Users can look themselves up and see:
- What they are associated with  
- Which topics are attributed to them  
- How the product understands them in the social graph  

### **7. Filter-Like Behavior (Implicit via Query)**
While there is no explicit UI for filters, users can naturally specify:
- Location  
- Follower thresholds  
- Topic constraints  
- Roles  
- Specific industries  

The product translates these into search intent automatically.

---

## 5. Key User Flows

### **1. Generic Discovery**
1. User types broadened query: “People in tech who write about AR/VR.”  
2. Results show 10–20 relevant people with explanations.  
3. User can refine the query conversationally:  
   - “Only show ones with fewer than 10k followers.”  
   - “Show only engineers.”

### **2. Recruiting / Candidate Search**
1. User enters: “Backend engineers who post about distributed systems.”  
2. Product returns relevant candidates with profile context.  
3. User clicks through to X profiles to make contact.

### **3. Finding Friends / Building a Social Circle**
1. Query: “People in my city who love climbing and post about early-stage startups.”  
2. Results show profiles blending social and professional interests.  
3. User follows or messages through X.

### **4. Creator Visibility / Self-Search**
1. User searches for their own username or description.  
2. Product shows “how they appear” in the search engine:  
   - Topics  
   - Associated roles  
   - Short summary  
3. User gains insight into their digital identity.

---

## 6. Product Principles

### **1. Human-Centric Discovery**
Search should feel like discovering *people*, not documents or tweets.

### **2. Natural, Conversational Queries**
Users shouldn’t need filters, menus, or Boolean logic—just a thought expressed in plain language.

### **3. Explainability**
Every match comes with a concise explanation.  
Users understand “why this person,” creating trust and reducing ambiguity.

### **4. Identity-Respecting**
All data used is public; private or inferred personal attributes are never surfaced.  
Users can request removal from the index.

### **5. Topic-First, Not Keyword-First**
The system understands concepts, domains, and roles—not just string matches.

### **6. Multi-Purpose**
Search is not locked to a single use case:  
networking, recruiting, creator discovery, community mapping, and more.

---

## 7. Core Differentiators

### **1. Natural-Language People Search**
Unlike traditional social network search, which requires knowing a name or keyword, this tool allows queries expressing *intent* and *attributes*.

### **2. Concept-Level Understanding**
Search is powered by semantic representations of users, meaning results capture real interest and expertise, not only specific words.

### **3. Blended Personal + Professional Discovery**
Most platforms silo interest graphs and professional graphs.  
This tool unifies both: people can be discovered for *who they are*, not just job titles.

### **4. Transparent Explanations**
Each result includes a human-readable justification.

### **5. Aspirational / Social Utility**
Users can find:
- Collaborators  
- Cofounders  
- People with shared passions  
- Potential friends  
- Influencers or experts  
- People nearby  

It’s a *people graph explorer*.

---

## 8. Limitations, Constraints, and Expectations

### **1. Public Data Only**
The tool only uses publicly visible information.  
Private messages, private accounts, and protected content are not included.

### **2. Not Formal Personality or Skill Verification**
The tool estimates interests and roles based on public content—  
it does not guarantee identity, employment, or skill accuracy.

### **3. Influencer Metrics Are Relative, Not Absolute**
Follower thresholds and influence indicators are approximate signals.

### **4. Users May Not Match Complex or Niche Queries Perfectly**
For very specific requests, the system may return best-effort matches.

---

## 9. Vision: The People Graph, Searchable  
Long-term, the product becomes:

- A way to explore communities around the world.  
- A tool for mapping social identity, interest clusters, and expertise.  
- A new public layer of people discovery that sits on top of X’s ecosystem.  
- A universal people-finder for builders, creators, professionals, and everyday users.

The end goal: **help people find the right humans faster, whether for work, friendship, creativity, or shared curiosity.**
