# Raw Capture: X Post by @zeddotdev (2051754884295205031)

## Source
https://x.com/i/status/2051754884295205031

## Tweet Text
We're not here to chase the AI money, and we're not here to write sloppy code.

We're building the thing that comes after git.
@conradirwin shares what we're doing and why:

## Linked Content Title
We're Not Building AI Features for the Money - Zed Blog

## Linked Content (Fetched via web-fetcher)
We shipped Parallel Agents recently, and (most) people seem to really like it. However, we saw some common themes in the feedback that grated. Comments like:

"It's clear that Zed's focus is on AI integration because that's where the money's going."

"It doesn't mean the bulk of their effort isn't going to AI slopshit."

Both categories of concern miss something important about what we're doing at Zed, and I want to speak to them.

Concern 1: AI is Where the Money's At
In fact, we were selling tokens at a loss to most paying AI users until we switched to token-based billing. Today we pass through LLM usage at the provider's list price plus a 10% markup that covers our infrastructure and prevents tire-kickers. People are desperate to get cheap access to frontier LLMs, and you really don't want to be the easiest way they can do this.

We were early in making this change, but feel increasing conviction we were correct. The pattern across the industry is the same: companies subsidize AI access at a loss for the chance to win big later, much like the early days of Uber and Lyft. Trillion-dollar companies, large AI labs and well-funded startups (who are still raising money every six months to balance their losses) can sustain that. We're none of those.

We are still a business, and we do need to make money. In the short term, we are going to ship Zed for Business, which makes it easier to use Zed with your colleagues. It has straightforward per-seat pricing for teams and enterprises and offers the basics: centralized billing, admin controls, and permissions. In the long term, we're going to monetize our vision for a collaborative workspace where humans and AI agents work together.

Concern 2: AI Code is Worthless
The second concern is that AI in an IDE is misguided, sloppy, and gets in the way of "real work". I understand this reaction, and to a great extent it's still true that LLMs can't build software, though they pretend that they can.

Today, most of my time is spent building the fundamentals of DeltaDB. We had some painful false starts: too much agentic coding led to code that smelled correct, but fell apart as soon as you started to build on it.

But I still use an agent heavily. It's astonishing how many things LLMs can now do. They make excellent rubber-ducks, they're good at pushing through refactorings, and they can write tests and identify edge cases about as well as I can. I still edit the code manually to ensure the narrative is clear, to keep my mental model of the problem up to date, and to ensure that the code actually does what it purports to do. But, in terms of lines of code written, I suspect it's now less than half.

I share this because I think a lot of developers are where I was a year ago. If you're skeptical, I understand; I was too, for good technical reasons. But the tools have gotten meaningfully better, and it's worth considering how you can evolve your workflow. Please don't use an LLM to avoid having to understand the problem you're solving, or how to solve it; but use it as a sparring partner to clarify your understanding, and to fill in the gaps, and to make yourself more productive.

You will see more AI features shipping in Zed, just like you'll continue to see core editor improvements. That's because our team is still building our ideal editing experience today, and we believe that includes some measure of agentic work.

What AI Means for Software
I don't have a crystal ball, and programming is changing rapidly. But some things are already clear: LLMs can help even very effective programmers to be more productive.

The cost of producing code is dropping rapidly and the barrier to entry for writing software is lower than it has ever been. More people are writing code, and more code is being written.

When code production gets cheaper, everything around it gets proportionally more expensive. Friction in sharing, reviewing, and maintaining code becomes a larger part of the total cost of delivering software, but the tooling we rely on for these tasks was designed for a world where humans typed every line. Discretized commits, pull requests, and snapshot-based reviews served us well, but they're overhead in a world where agents can produce working code faster than we can review it.

On the flip side, I know that well-designed systems still require a human in the driver's seat. Products, and the code that powers them, exist to help humans achieve their goals; and building them correctly requires human values, human judgment and a considerable amount of empathy. Agents can write the code, but deciding what to build, and how to build it still takes human craft and expertise.

Software development is a fundamentally collaborative exercise, our tools should move us from writing code to working together on it, but our collaboration tools haven't changed since Linus named git after himself 21 years ago.

What's Next for Zed
One comment from the Hacker News thread has stayed with me:

"I remember when Zed's main thing was 'collaborative' editing. Not as profitable as AI I suppose."

Our collaborative investments are, as Michael Caine puts it, like a duck: calm on the surface, but paddling like the dickens beneath. Realtime multiplayer editing was a foundational piece of Zed's thesis before LLMs took over the software world, and we still believe that the most productive engineering teams work collaboratively, the best products are built collaboratively, and the hardest problems are solved that way, too.

That said, we can't ignore the AI "thing". More and more engineers, including us, are increasingly choosing to use LLMs because it makes them more productive. We need to meet these people where they're at, and help them to work together instead of in increasing isolation. By encouraging people to work together, to build a shared model of the problem space and to understand how they want to solve it, we hope that we can make software engineering a less chaotic and more value-driven enterprise.

We're building towards our vision with DeltaDB, a synchronization engine that tracks every operation at character-level granularity, designed to let humans and agents share a single, consistent view of the codebase as it evolves. It's how we plan to make conversations about code stay connected to the code itself, whether you're working together in real time or asynchronously, and it's how we plan to make Zed a generationally successful company in the long term.

It may not look like much is happening on the surface, but the vision has never been closer to reality and we're excited to share more very soon.
