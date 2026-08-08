// 75 curated, textbook/well-replicated facts about the brain — plasticity,
// memory, sleep, perception, development, and cognitive limits/potential.
// Kept deliberately conservative (no contested or "5% of the brain" myths).
export const BRAIN_FACTS_SEED: { text: string; topic: string }[] = [
  // Plasticity
  { text: "The adult human brain continues to form new synapses throughout life — a property called synaptic plasticity — even though the rate of new neuron formation slows dramatically after childhood.", topic: "plasticity" },
  { text: "London taxi drivers who memorize the city's ~25,000 streets (\"The Knowledge\") show measurably larger posterior hippocampi than control subjects, a landmark finding in adult structural plasticity.", topic: "plasticity" },
  { text: "Musicians who begin training before age seven often develop a larger corpus callosum, the band of fibers connecting the brain's two hemispheres.", topic: "plasticity" },
  { text: "After a stroke damages one brain region, neighboring or homologous regions can partially take over lost functions through a process called functional reorganization.", topic: "plasticity" },
  { text: "Learning a new motor skill, like juggling, can measurably increase gray matter density in visual and motion-processing areas within weeks.", topic: "plasticity" },
  { text: "The brain's white matter — the insulated wiring between regions — keeps maturing into a person's mid-20s, which is one reason impulse control continues developing through adolescence.", topic: "plasticity" },
  { text: "Phantom limb sensations arise partly because the brain's somatosensory map is plastic: neighboring body-part representations can expand into the cortical territory freed up by amputation.", topic: "plasticity" },
  { text: "Blind individuals often show activation in their visual cortex while reading Braille, an example of cross-modal plasticity where one sense recruits another sense's cortical real estate.", topic: "plasticity" },
  { text: "Meditation training has been linked in longitudinal studies to measurable increases in cortical thickness in regions tied to attention and sensory processing.", topic: "plasticity" },
  { text: "Enriched environments — more social interaction, exercise, and novelty — reliably increase dendritic branching in animal studies, giving neurons more surface area for connections.", topic: "plasticity" },

  // Memory
  { text: "Memory consolidation — the process that stabilizes a new memory for long-term storage — depends heavily on sleep, particularly slow-wave and REM sleep.", topic: "memory" },
  { text: "The hippocampus is critical for forming new explicit (fact- and event-based) memories, but it is not where long-term memories are permanently stored; over time, memories are gradually transferred to the cortex.", topic: "memory" },
  { text: "Working memory — the capacity to hold and manipulate information moment to moment — is typically limited to around three to five meaningful chunks at a time, not the once-popular \"seven plus or minus two.\"", topic: "memory" },
  { text: "Each time a memory is recalled, it becomes briefly unstable and must be \"reconsolidated,\" which is part of why memories can subtly change each time we remember them.", topic: "memory" },
  { text: "Procedural memories, like riding a bike, rely on different brain circuits (including the basal ganglia and cerebellum) than declarative memories of facts and events, which is why they're often preserved even in amnesia.", topic: "memory" },
  { text: "The famous patient H.M., who had his hippocampi removed to treat epilepsy, could no longer form new long-term declarative memories but could still learn new motor skills — direct evidence that memory is not a single unified system.", topic: "memory" },
  { text: "Spaced repetition — reviewing information at increasing intervals — produces more durable long-term memory than cramming the same material in one sitting, a robust finding known as the spacing effect.", topic: "memory" },
  { text: "Emotional arousal at the time of an event tends to strengthen memory for that event, mediated in part by the amygdala's modulation of hippocampal encoding.", topic: "memory" },
  { text: "Sleep deprivation before learning impairs the hippocampus's ability to encode new information, not just its ability to consolidate memories afterward.", topic: "memory" },
  { text: "Retrieval practice — actively recalling information rather than passively re-reading it — produces stronger long-term retention, a finding often called the testing effect.", topic: "memory" },

  // Sleep
  { text: "A typical night of sleep cycles through roughly 90-minute stages of non-REM and REM sleep, with REM periods lengthening toward morning.", topic: "sleep" },
  { text: "During slow-wave sleep, the brain shows large, synchronized neural oscillations that are thought to help transfer memories from the hippocampus to longer-term cortical storage.", topic: "sleep" },
  { text: "The glymphatic system, a network that clears metabolic waste from brain tissue, is markedly more active during sleep than wakefulness in animal studies.", topic: "sleep" },
  { text: "Most adults need about 7 to 9 hours of sleep per night for optimal cognitive function, though individual sleep need varies genetically.", topic: "sleep" },
  { text: "Chronic sleep restriction impairs attention and reaction time in ways that can accumulate across days, even if the person doesn't subjectively feel sleepier.", topic: "sleep" },
  { text: "During REM sleep, the brain actively suppresses signals to the body's voluntary muscles — a state called REM atonia — which normally prevents us from acting out our dreams.", topic: "sleep" },
  { text: "Naps as short as 10 to 20 minutes can measurably improve alertness and performance, without the grogginess (\"sleep inertia\") that often follows longer naps.", topic: "sleep" },
  { text: "The suprachiasmatic nucleus, a small region of the hypothalamus, acts as the brain's master circadian clock, synchronized primarily by light hitting the retina.", topic: "sleep" },
  { text: "Sleep spindles — brief bursts of oscillatory brain activity during non-REM sleep — are associated with the strength of newly consolidated memories, and their density tends to decline with age.", topic: "sleep" },
  { text: "Blue-wavelength light in the evening is especially effective at suppressing melatonin release, which is part of why screen use before bed can delay sleep onset.", topic: "sleep" },

  // Perception
  { text: "The brain fills in the blind spot where the optic nerve exits each retina, seamlessly interpolating from surrounding visual information so we normally never notice the gap.", topic: "perception" },
  { text: "Roughly a third of the primate visual cortex is devoted to processing visual information, more cortical territory than any other single sense.", topic: "perception" },
  { text: "Perceived pitch and perceived loudness are processed by at least partly separate neural pathways, which is part of why hearing damage can selectively impair one without the other.", topic: "perception" },
  { text: "Peripheral vision is more sensitive to motion and low light than central vision, because the retina's periphery is dominated by rod photoreceptors rather than cones.", topic: "perception" },
  { text: "The McGurk effect, in which mismatched lip movements change what syllable a listener perceives, demonstrates that speech perception integrates visual and auditory information automatically.", topic: "perception" },
  { text: "Human color perception is trichromatic, built from just three types of cone photoreceptors, yet the brain can distinguish millions of color shades through combinatorial processing.", topic: "perception" },
  { text: "Proprioception — the sense of where your body parts are in space — relies on receptors in muscles and joints and is processed largely outside conscious awareness.", topic: "perception" },
  { text: "The brain constantly predicts incoming sensory information and updates those predictions based on error signals, a framework known as predictive processing.", topic: "perception" },
  { text: "Synesthesia, in which stimulating one sense reliably triggers a perception in another (like seeing colors for letters), is estimated to occur in roughly 2 to 4 percent of the population.", topic: "perception" },
  { text: "Taste is often confused with flavor, but flavor perception depends heavily on smell — which is why food tastes bland when the nose is blocked.", topic: "perception" },

  // Cognitive limits & potential
  { text: "There is no reliable scientific evidence for the popular claim that humans use only 10 percent of their brains; brain imaging shows virtually all regions have identifiable functions and most are active at some point during a normal day.", topic: "cognition" },
  { text: "Cognitive reserve — built through education, complex work, and mentally engaging activity — is associated with a delayed onset of dementia symptoms even when underlying brain pathology is similar.", topic: "cognition" },
  { text: "So-called \"brain training\" games reliably improve performance on the trained task, but evidence for broad transfer to general intelligence or unrelated cognitive skills is weak.", topic: "cognition" },
  { text: "Attention operates as a limited resource: sustained multitasking on demanding tasks typically increases errors and slows performance compared with single-tasking, a cost measurable even in expert multitaskers.", topic: "cognition" },
  { text: "Fluid intelligence — the ability to reason and solve novel problems — tends to peak in early adulthood, while crystallized intelligence, built from accumulated knowledge, can continue increasing into middle age and beyond.", topic: "cognition" },
  { text: "Decision fatigue is a well-documented phenomenon in which the quality of choices can decline after a long sequence of decisions, though its size and mechanisms are still debated.", topic: "cognition" },
  { text: "Bilingual individuals often show enhanced executive function, particularly in tasks that require switching between competing rules, likely from constant practice suppressing one language while using another.", topic: "cognition" },
  { text: "The brain uses about 20 percent of the body's resting energy budget despite making up only about 2 percent of body weight, reflecting the high metabolic cost of neural signaling.", topic: "cognition" },
  { text: "Expert performance in domains like chess or music is strongly associated with deliberate practice — focused, effortful training with feedback — rather than raw hours of exposure alone.", topic: "cognition" },
  { text: "Aerobic exercise reliably increases levels of brain-derived neurotrophic factor (BDNF), a protein that supports neuron growth and survival, particularly in the hippocampus.", topic: "cognition" },

  // Development
  { text: "The human brain reaches roughly 90 percent of its adult volume by around age six, but the fine-tuning of neural circuits, especially in the prefrontal cortex, continues for another two decades.", topic: "development" },
  { text: "Synaptic pruning, the elimination of weaker or unused neural connections, peaks during adolescence and is thought to make surviving circuits more efficient.", topic: "development" },
  { text: "Myelination — the process of insulating axons with fatty sheaths that speed neural transmission — continues in the prefrontal cortex well into a person's twenties.", topic: "development" },
  { text: "Infants are born with more neurons and synapses than they will have as adults; experience-dependent pruning, not just growth, shapes the developing brain.", topic: "development" },
  { text: "Critical periods, windows of heightened plasticity for skills like language acquisition, are strongest early in life but many aspects of learning remain possible, just less efficient, in adulthood.", topic: "development" },
  { text: "The prefrontal cortex, involved in planning and impulse control, is among the last brain regions to fully mature, which helps explain typical patterns of risk-taking in adolescence.", topic: "development" },
  { text: "Prenatal brain development produces neurons at an estimated rate of hundreds of thousands per minute during peak periods of neurogenesis.", topic: "development" },
  { text: "Early childhood adversity and chronic stress can measurably affect the developing hippocampus and amygdala, though the brain's plasticity also supports substantial recovery with supportive environments.", topic: "development" },
  { text: "Babies can distinguish and discriminate the sounds of any human language at birth, but this ability narrows over the first year of life to the sounds relevant to their native language(s).", topic: "development" },
  { text: "Adult neurogenesis — the birth of new neurons — has been documented in the hippocampus, though the extent and functional significance of new neuron production in adult humans remains an active area of research.", topic: "development" },

  // Neurotransmitters, anatomy, general
  { text: "The human brain contains roughly 86 billion neurons, each of which can form thousands of synaptic connections with other neurons.", topic: "general" },
  { text: "Dopamine is often popularly described as a \"pleasure chemical,\" but its primary role in reward circuits is signaling prediction and motivation — the anticipation of reward — more than pleasure itself.", topic: "general" },
  { text: "Glial cells, once thought to be mere structural support for neurons, actively regulate synaptic signaling, immune responses, and the brain's blood supply.", topic: "general" },
  { text: "Action potentials, the electrical signals neurons use to communicate, travel along myelinated axons at speeds up to about 120 meters per second, roughly 250 miles per hour.", topic: "general" },
  { text: "The two hemispheres of the brain are connected by the corpus callosum, a bundle of roughly 200 million nerve fibers that allows rapid communication between them.", topic: "general" },
  { text: "Serotonin is produced not only in the brain but also extensively in the gut, where it plays a major role in regulating digestion.", topic: "general" },
  { text: "The cerebellum, long associated mainly with motor coordination, contains more neurons than the rest of the brain combined and also contributes to certain cognitive and language functions.", topic: "general" },
  { text: "Neurons communicate largely through chemical synapses, where an electrical signal triggers the release of neurotransmitter molecules that cross a microscopic gap to the next cell.", topic: "general" },
  { text: "The blood-brain barrier is a selectively permeable boundary formed by tightly joined cells lining brain blood vessels, protecting neural tissue from many pathogens and toxins circulating in the blood.", topic: "general" },
  { text: "Mirror neurons, first identified in macaque monkeys, fire both when an animal performs an action and when it observes another individual performing that same action.", topic: "general" },

  // Quantum biology / computational (lighter representation, factual and hedged)
  { text: "Quantum biology studies whether quantum mechanical effects, like coherence and tunneling, play a functional role in biological processes such as photosynthesis and avian magnetoreception — an active and still-debated research area.", topic: "quantum_biology" },
  { text: "Some migratory birds are hypothesized to sense Earth's magnetic field via a quantum process in a retinal protein called cryptochrome, though the mechanism remains a subject of ongoing research.", topic: "quantum_biology" },
  { text: "Computational neuroscience uses mathematical models, from single-neuron biophysics to large-scale network simulations, to understand how neural circuits give rise to behavior.", topic: "computational" },
  { text: "Artificial neural networks, the basis of much of modern AI, were loosely inspired by biological neurons, but the two systems differ substantially in how they learn and process information.", topic: "computational" },

  // More perception / cognition to round out ~75
  { text: "Change blindness — the surprising difficulty of noticing large changes in a visual scene between glances — reveals that visual perception is far less complete and continuous than it subjectively feels.", topic: "perception" },
  { text: "The brain integrates signals from the vestibular system in the inner ear with vision and proprioception to maintain balance; conflicts between these signals are a common cause of motion sickness.", topic: "perception" },
  { text: "Pain perception is not a simple readout of tissue damage; psychological state, attention, and expectation can substantially modulate how intensely pain is experienced, a basis for the placebo and nocebo effects.", topic: "perception" },
  { text: "The just-noticeable difference for many senses follows a roughly logarithmic relationship with stimulus intensity, described classically by the Weber-Fechner law.", topic: "perception" },
  { text: "Cognitive load theory holds that working memory has limited capacity for processing new information, which is why well-designed instructional materials try to minimize unnecessary mental effort.", topic: "cognition" },
  { text: "The default mode network, a set of brain regions active during rest and mind-wandering, is implicated in self-referential thought, memory retrieval, and imagining the future.", topic: "cognition" },
  { text: "Confirmation bias, the tendency to favor information that supports existing beliefs, has measurable neural correlates in how the brain processes belief-consistent versus belief-inconsistent evidence.", topic: "cognition" },
  { text: "The Stroop effect, in which naming the ink color of a mismatched color word (like the word \"blue\" printed in red) takes longer than naming a matched one, is a classic demonstration of automatic versus controlled cognitive processing.", topic: "cognition" },
  { text: "Practicing a skill under varied conditions (varied practice) often produces better long-term retention and transfer than practicing the exact same conditions repeatedly (blocked practice), even though blocked practice can feel like it's working better in the moment.", topic: "cognition" },
  { text: "The brain's reward system, centered on dopaminergic pathways from the ventral tegmental area, responds not just to receiving rewards but to cues that predict them.", topic: "general" },
];
