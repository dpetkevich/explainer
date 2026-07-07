# Space Intelligence

The Space Domain Is Changing
The orbital economy was built on a simple assumption: satellites go up and stay put. A communications satellite reaches GEO, parks in its slot, and operates for 15 years. A broadband constellation deploys to a fixed shell and maintains station. Propulsion exists to correct drift, not to maneuver.
That assumption is breaking. The build-out of orbital infrastructure over the next 15 years will dwarf anything the space industry has produced in its first 65.
Start with satellite communications. SpaceX operates ~10,000 active Starlink satellites as of March 2026, with authorization for up to 42,000. Amazon Leo holds FCC approval for 7,727. Blue Origin filed TeraWave for 5,408 enterprise-grade satellites in January 2026. China has disclosed plans across three major constellations: Guowang (~13,000), Qianfan (~15,000), and Honghu-3 (~10,000). The combined SatCom pipeline exceeds 95,000 satellites.
Then the step-change. On 30 January 2026, SpaceX filed with the FCC for one million orbital data center satellites operating between 500 and 2,000 km altitude in sun-synchronous orbit. The filing described a constellation of solar-powered compute nodes connected via petabit-class optical laser mesh, designed to serve AI inference workloads. Starcloud, a Y Combinator graduate that trained the first LLM on a GPU in orbit in December 2025, filed for 88,000 satellites on 3 February. Blue Origin filed Project Sunrise on 19 March for 51,600 orbital data center satellites. China's Three-Body Computing Constellation adds another 2,800.
Combined broadband and orbital data center filings now exceed 1.2 million satellites. The current active population sits at ~15,000.
The Orbital Infrastructure Explosion



Projected Satellite Populations




Sources: FCC filings, ITU filings, operator disclosures. Ramps are Mach33 illustrative estimates.


The chart traces cumulative satellite deployments from 2020 through 2040 across satellite communication and orbital data center constellations. The broadband layer (purple) builds through the 2020s as Starlink, Amazon Leo, TeraWave, and Chinese constellations ramp production. The inflection arrives around 2028–2029 as orbital data center constellations (green) begin deploying. By the mid-2030s, the ODC layer dominates total orbital population.
The demand signal is straightforward. Every satellite on orbit reduces to an energy or mass problem. Repositioning, collision avoidance, servicing, de-orbiting: these are no longer edge cases in a world of 1.2 million assets but will become infrastructure requirements. And the propulsion systems serving today's satellite population were designed for a static constellation paradigm that the next decade will leave behind.

Enter Portal: Jeff Thornburg and a History of Building the Nearly Impossible
Jeff Thornburg built the world's first full-flow staged combustion engine.
That sentence carries weight in propulsion engineering. Full-flow staged combustion had been theorized for decades but never produced. Thornburg made it real at the Air Force Research Laboratory, proving that the most complex engine cycle in rocketry could be built and fired. Elon Musk recruited him to SpaceX to do it again. As VP of Propulsion, Thornburg led the Raptor program from concept through to production and consulted during the V2 scale-up; turning a laboratory achievement into repeatable manufacturing.
He then moved to Amazon's LEO constellation program, where he helped engineer satellite propulsion systems designed for production at thousands-of-units cadence.
A former U.S. Air Force officer, Thornburg has spent two decades at the boundary between propulsion physics and industrial scale. The pattern is specific: prove the physics, then solve the scaling problem. At Portal, he is running that sequence again.
"I'm used to being told what I'm building is impossible."
Thornburg founded Portal Space Systems in Q4 2021 with a specific thesis: the space economy had solved launch but had not solved maneuverability. The enabling technologies for solar-thermal propulsion, studied for decades but never flight-ready, had matured. Additive manufacturing, high-temperature materials, and lightweight optics converged to make the architecture viable. Thornburg recognized the window and built a company around it.
The Rocket Equation: Why Responsive Delta-V Was Never an Option
Propulsion in space operates under a constraint that terrestrial engineers do not face. The Tsiolkovsky rocket equation ties a vehicle's delta-v (ΔV — its total capacity to change velocity) to two variables: the efficiency of the propellant (measured as specific impulse, or Isp, in seconds) and the ratio of wet mass to dry mass. Higher Isp means more delta-v per kilogram of propellant. Higher thrust means faster maneuvers. For 50 years, operators have been forced to choose one or the other.
Storable chemical propulsion delivers high thrust. A bipropellant system fires at hundreds of newtons and completes burns in seconds to minutes. The penalty is low Isp (~180–330s for storable propellants) and rapid fuel consumption. A 500 kg spacecraft on storable biprop exhausts its delta-v budget at ~700 m/s. Chemical systems are fast but disposable: each maneuver consumes a significant fraction of the vehicle's remaining life.
Electric propulsion (Hall-effect thrusters) inverts the trade. Isp reaches ~1,500s, stretching propellant budgets across thousands of maneuvers. Thrust drops to millinewtons. A 100 m/s transfer takes ~220 hours. A 5,000 m/s transfer, the budget needed for LEO-to-GEO, takes >12,600 hours: more than 500 days of continuous firing. Electric systems are efficient but operationally impractical for time-sensitive repositioning. Xenon propellant at $2,500/kg adds cost pressure at scale.
For most of the space age, this binary was tolerable. Satellites parked in fixed orbits and rarely moved. Defense assets in GEO maintained station with millinewton thrusters. Broadband constellations held shells with low-impulse corrections. Responsive delta-v, the ability to maneuver a spacecraft rapidly, repeatedly, and affordably, was not available. It was also not required.
The demand signal described in the previous section changes that equation. A world of 1.2 million planned orbital assets, adversarial on-orbit maneuvering by China and Russia, and orbital data centers requiring active thermal and positional management needs a propulsion architecture that delivers both speed and endurance.
Solar-Thermal Propulsion: The 'Goldilocks' Class 
Portal's system concentrates sunlight via deployable mirrors onto a patented 3D-printed heat exchanger, heating propellant to generate thrust. No combustion. No nuclear material. The result: ~350-450s Isp with ammonia propellant and ~800 Isp with hydrogen, at ~100–200N thrust (orders of magnitude above electric). Total delta-v budget of up to 5-6 km/s per vehicle. The propellant costs $1/kg. The vehicle is storable, reusable, and capable of hundreds if not thousands of restarts.
The Isp/Thrust chart below shows where solar thermal sits in the propulsion taxonomy. Portal's Supernova occupies the goldilocks zone between storable chemical and electric: it delivers chemical-class thrust at an Isp that exceeds storable chemical's ceiling.

Position on the chart alone understates the differentiation. What the axes do not show is total delta-v budget (5–6 km/s versus <700 m/s for storable biprop), restart capacity (hundreds versus limited), and propellant cost ($1/kg ammonia versus $50–2,500/kg for chemical and electric propellants). These are the operational dimensions that separate a maneuverable spacecraft from a conventional one. The result is that moden solar-thermal propulsion occupies a goldilocks zone between chemical and electric on both axes: cost and time. Our propulsion economics model quantifies the advantage on a level playing field. Each system assumes the same 500 kg baseline spacecraft dry mass and a standardised $10M hardware cost, isolating propulsion performance from differences in vehicle maturity or programme scale. Overhead mass is assigned by propulsion type based on published subsystem requirements. Maneuver cost is then composed of three elements: propellant mass derived from the rocket equation, propellant and launch costs, and hardware amortisation proportional to the fraction of total delta-v capacity consumed. Holding hardware cost constant across architectures avoids adding noise from variable pricing assumptions and keeps the comparison focused on what the physics and economics of each propulsion class actually deliver



Cost per Maneuver by Propulsion Type




Source: Mach33 propulsion economics model. 500 kg baseline spacecraft, $10M standardised hardware cost. Propellant costs: ammonia $1/kg, methalox $1/kg, xenon $2,500/kg. All propellants launched at $1,500/kg. Hardware amortised by fraction of total ΔV consumed per manoeuvre. Chemical storable terminates at ~700 m/s (tank capacity limit)


Solar thermal tracks as the lowest-cost propulsion class across the full ΔV spectrum. At 100 m/s, solar thermal costs ~$222k per manoeuvre versus $1.46M for storable biprop, $2.03M for methalox, and $216k for electric Hall (the one point where electric is competitive). By 700 m/s, solar thermal holds at ~$1.39M while storable biprop hits its physical limit and terminates. At 5,000 m/s, solar thermal costs ~$9.1M versus $10.9M for electric Hall. A Methalox kick-stage of this mass cannot reach this ΔV level. The cost advantage is structural, and it compounds across three layers:

Propellant: ammonia at $1/kg versus xenon at $2,500/kg keeps the solar-thermal curve flat as delta-v increases, while electric systems face propellant cost scaling that erodes their efficiency advantage at higher delta-v budgets. 
Hardware amortisation: Supernova's 50+ restarts and 5-6 km/s total delta-v budget mean its hardware cost is spread across dozens of maneuvers, whereas chemical stages designed for limited burns concentrate their full system cost into a handful of uses. Electric thrusters fare poorly here too; they have a finite delta-v lifetime set by propellant throughput and thruster degradation, so as individual manoeuvres grow larger each one consumes a bigger fraction of the system's total capacity and absorbs a correspondingly bigger share of hardware cost. 
Energy source: solar thermal draws its heat from sunlight (free, external, and effectively unlimited) so the system's energy cost per manoeuvre is zero. Chemical systems burn their energy supply along with their propellant. Electric thrusters draw power from solar panels but degrade with accumulated use, making the thruster hardware itself a slow consumable.

Solar thermal is the only architecture where all three cost drivers — propellant, hardware utilisation, and energy source — work in the same direction. In addition, Portal's engineering approach to it's STP sets it up well for mass manufacturing scale leveraging Wright's law learning rates to further improve it's cost advantages over chemicl and electric.



Maneuver Time by Propulsion Type	




Total mission time: engine burn plus coasting adjustment. Chemical methalox includes 24-hour launch delay (cryogenic, not storable on orbit). Solar thermal includes 50% coasting overhead for multi-arc burns. Electric Hall assumes continuous low-thrust spiral with no coast. Chemical storable treated as near-instantaneous impulsive burns. Source: Mach33 propulsion economics model


The time axis is where the defense argument crystallises. At 100 m/s, solar thermal completes the maneuver in roughly ten minutes (including coasting for multi-arc burns). Electric Hall takes approximately 223 hours (9 days). At 1,000 m/s, solar thermal finishes in roughly 1.4 hours. Electric takes approximately 2,280 hours (95 days). At 5,000 m/s, the budget for LEO-to-GEO transfer, solar thermal delivers in roughly 9 hours. Electric Hall requires over 12,600 hours: 527 days.
Storable chemical (biprop) matches solar thermal on speed at low delta-v, completing burns in minutes, but we estimate its tank capacity caps out at approximately 700 m/s for a 500kg vehicle; beyond that it simply cannot compete. Methalox (non-storable chemical) has the raw thrust to go further, but it is cryogenic and cannot be stored on orbit without boil-off. Any methalox mission must include a launch and fuelling window, adding a minimum 24-hour delay before the burn even begins. If pre-staged and fuelled in orbit the burn times are fast, but that assumption requires logistics infrastructure that does not yet exist at scale. Solar thermal sidesteps both constraints: its ammonia propellant is storable indefinitely, and the vehicle can sit on orbit for months then fire on command.
Solar thermal is the only propulsion class that stays in single-digit hours across the full delta-v spectrum while maintaining the lowest cost per maneuver. For a defence customer, the difference between a 9-hour repositioning and a 527-day electric spiral, or a 24-hour launch dependency for methalox, determines whether a mobility asset can respond to a threat in real time or arrives long after the window has closed.Editor's note: assuming zero boil off crygenic fuel storage is solved, Portal's system gets to leverage the advantages arguably to greater effect dramatically improving delta-v up to beyond 10,000 m/s. The thermal advantage remains. 

Why Solar Thermal Wasn't Viable Before, and Why It Is Now
Solar-thermal propulsion is not a new concept. NASA and the U.S. Air Force studied it from the 1970s through the 2000s. A 1979 Rockwell study concluded the physics were sound. Engineers demonstrated >800s Isp with hydrogen in ground tests. The program was shelved because three critical subsystems could not be built with available technology.
The heat exchanger required intricate internal channel geometries to maximize heat transfer. In the 1980s, this meant hundreds of individually machined components brazed together, a manufacturing process that was expensive, fragile, and impossible to optimize. Portal's Flare heat exchanger is a single monolithic 3D-printed part in a high-temperature refractory alloy, manufactured using additive techniques inherited from rocket engine production. The internal geometry is computationally optimized for thermal efficiency approaching the theoretical limit of its propellant.
Materials imposed a temperature ceiling. The 1980s test campaigns reached ~1,800K before structural failure. Portal operates with refractory alloys stable at up to and potentially beyond ~3,000K, widening the operating envelope and increasing specific impulse.
The mirrors were too heavy. Deployable optics in prior decades could not achieve the concentration ratios needed at acceptable mass. Modern membrane reflectors deliver >1,000 W/kg power density, an order of magnitude above the ~100 W/kg typical of conventional solar arrays. Lightweight deployable optics make the mass budget close.
Portal completed HEX thruster testing in July 2025. Mirror deployment structures have been under test since December 2025. The remaining technical risk is mirror deployment on orbit, which Portal has mitigated through a partnership with a heritage deployables company with decades of spaceflight experience, supplemented by engineers recruited from Starlink and Kuiper programs.
Defense Demand: Contracts, Not Concepts
China and Russia have demonstrated rapid on-orbit maneuvering capabilities. The U.S. Space Force has identified responsive space operations as a top priority. Incumbent prime contractors, Lockheed Martin, Boeing, and Northrop Grumman, do not offer maneuverable spacecraft at the speed or cost profile Portal is building toward.
Portal's defense traction is funded and contracted.
The company holds a $45M STRATFI contract from the U.S. Space Force, a milestone-driven award spanning 2 years (extendable to 4) that covers Supernova's first mission and factory buildout. STRATFI is reserved for technologies the Space Force deems critical to national security. Portal has secured 7 SBIRs (~$5.5M total) across Phase II and Phase III awards. The company maintains a pipeline of more than $400M in opportunities over the next 24 months.
Portal has built direct relationships with strategic commands within DOW, a pathway that doesn't preclude teaming with primes but doesn't require subordination to them either. The company holds FCC and NOAA licenses for upcoming missions and has booked initial flights on SpaceX Falcon 9 Transporter rideshares. The bridge from defense to commercial is the same vehicle architecture: the Supernova that repositions a defense payload can manage constellation assets, service commercial satellites, or remove debris.
There is risk in continued and scaling adoption from defense customers. Procurement cycles are long, budget priorities shift, and program-of-record status takes years to establish. We acknowledge this. Portal's traction, however, exceeds what we typically see at the pre-Series A stage in defense-oriented space companies. Seven SBIRs and a STRATFI on early-stage equity is a track record the acquisition community notices. We view the defense pipeline as a floor, not a ceiling, for Portal's revenue trajectory.
Manufacturing Scale: From Factory to Hundreds of Supernova
Portal builds two platforms on a shared production line.
Supernova is the flagship: a solar-thermal spacecraft designed for military and intelligence missions requiring rapid repositioning. At up to 5–6 km/s of delta-v, the vehicle operates from LEO through cislunar orbits with radiation-hardened hardware and is designed for refuelability to extend mission duration. The architecture is designed to scale to larger platforms as demand and mission profiles evolve. We have confidence in attractive margins at the unit level, with cost per delta-v that compares favorably to any storable chemical or electric alternative on the market. Supernova's first orbital demo is targeted for 2027.
Starburst is the tactical complement: a smaller, ESPA-class platform using conventional RCS thrusters (not solar thermal), sharing 81% of Supernova's components. Starburst targets surveillance and reconnaissance missions with attractive margins and serves as a risk-reduction step for the Supernova program. First orbital flight is scheduled for October 2026.
Portal's 52,000 sq ft factory comes online in June 2026, designed for integrated engineering and manufacturing to avoid the silos that slow aerospace production. The facility is designed to scale to dozens of vehicles per year, with planned footprint expansions capable of scaling to hundreds of vehicles a year. Space hasn't seen this type of scale outside of telecom satellites. 
The path from dozens to hundreds of Supernova providing persistent low-cost maneuverability on orbit is an engineering scaling problem. Jeff Thornburg has solved that class of problem before: he led the Raptor engine programme at SpaceX from concept through to scaled production, consulted during the V2 scale-up, and then moved to Amazon's LEO constellation programme where he helped engineer satellite propulsion systems designed for manufacturing at thousands-of-units cadence. Portal's challenge of building a high-performance spacecraft bus at repeatable volume sits squarely in the intersection of those experiences. Jeff is up to this challenge. 
The Funding Round
Mach33 proudly led Portal's Series A in close collaboration with Geodesic Capital and significant participation from Booz Allen Ventures and Ark Invest, raising $50M to fund the transition from an extremely capital-efficient company into one with a war chest to execute and scale into rapidly growing customer demand.
Geodesic Capital is a Japanese-U.S. dual-use defense focused fund. Japan's proximity to Chinese space capabilities and its expanding bilateral defense relationship with the United States make Geodesic the right investor to help Portal scale into allied-nation defense markets.
Booz Allen Ventures is the venture arm of one of the largest defense consultancies in the United States. Their participation brings institutional DoW relationships that accelerate procurement pathways and strategic alignment across defense acquisition.
We are proud to have ARK Invest join as a leader in funding disruptive technology. Their participation is consistent with a broader thesis on space infrastructure and exponential technology platforms, and their signal carries weight with the institutional investor community.These new investors along with existing deep tech investors AlleyCorp and FUSE, make for an outstanding team of operators and investors, we are proud to work alongside.
Portal has raised ~$20M in prior equity and secured >$50M in government funding. That ratio of non-dilutive to equity is a measure of how efficiently this team converts capital into milestones. This round marks the shift from proving the technology to scaling the business.
Investor Takeaways


The demand signal is structural, not cyclical. Over 1.2 million satellites have been filed in the last 18 months. Orbital data centers, broadband mega-constellations, and defense proliferation are creating a market for responsive in-space movement that did not exist two years ago. This demand scales with orbital density and does not depend on any single operator's success.


Solar thermal is the only propulsion architecture that serves this demand at scale. Our model shows it is the lowest-cost and fastest option across the full delta-v spectrum. Storable chemical propulsion cannot deliver the required delta-v budgets. Electric propulsion cannot deliver the required speed. Over $2B of venture capital has gone into chemical and electric in-space mobility systems that face these physics ceilings. Solar thermal breaks through them.


Portal's defense revenue is contracted, not speculative. $45M STRATFI, 7 SBIRs, and a pipeline of more than $400M in opportunities over the next 24 months. The defense customer provides a revenue floor while the commercial market for constellation management and satellite servicing develops through the late 2020s and early 2030s.


The team has done this before. Jeff Thornburg proved a propulsion concept the industry considered nearly impossible (full-flow staged combustion at AFRL) and then re-engineered it for economic scale (Raptor at SpaceX). The same pattern applies at Portal. The risk here is execution tempo, not technical feasibility.


Bridge to nuclear positions Portal for the next propulsion cycle. Solar-thermal architecture achieves ~90% of nuclear-thermal performance at ~10% of the cost. The same heat exchanger technology is directly applicable to future nuclear-thermal designs, replacing sunlight with a reactor. When regulations and market demand permit nuclear propulsion (likely 2030s), Portal's engineering base, flight heritage, and customer relationships will position it to lead that transition.


The physics and the demand signal are what we are underwriting. We believe Portal occupies a structural gap in the propulsion market that the next decade of orbital operations will fill, and that Jeff Thornburg is the right person to build the company that fills it.
