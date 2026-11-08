/* ==========================================================================
   ClassPulse — curriculum.js
   NCDC (Uganda National Curriculum Development Centre) competency-based
   curriculum engine: syllabus starter pack, scheme-of-work generator,
   lesson-plan generator, record of work, e-resource mapper.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const CU = (CP.curriculum = {});

  CU.NCDC_NOTE =
    "Aligned to the NCDC Lower Secondary Competency-Based Curriculum and the " +
    "Upper Secondary syllabus. Verify against the current NCDC syllabus/Teachers' " +
    "Guide for your subject before submission.";

  /* --------------------------------------------------------------------------
     Compact syllabus starter pack.
     Entry: [topic, periods, content, competences[], outcomes?]
     ------------------------------------------------------------------------ */
  const P = (topic, periods, content, comps) => ({ topic, periods, content, comps });

  const SYL = {
    Mathematics: {
      S1: [
        P("Whole Numbers", 12, "Place value; number bases; operations on whole numbers; number patterns", ["Apply number bases in everyday situations", "Compute accurately without calculators"]),
        P("Fractions, Decimals and Percentages", 14, "Types of fractions; operations; conversion; percentage applications", ["Convert between fractions, decimals and percentages", "Solve real-life problems involving percentages"]),
        P("Algebraic Expressions", 12, "Forming expressions; simplifying; like terms; substitution", ["Form expressions from word statements", "Simplify and evaluate expressions"]),
        P("Equations and Inequalities", 12, "Linear equations; simple inequalities; word problems", ["Solve linear equations and inequalities", "Model real-life situations using equations"]),
        P("Geometry of Plane Figures", 12, "Angles; triangles; quadrilaterals; polygons; angle properties", ["Construct plane figures using instruments", "Apply angle properties to solve problems"]),
        P("Statistics and Probability", 10, "Data collection; tables; graphs; measures of central tendency; simple probability", ["Organise and present data", "Interpret graphs to make decisions"]),
      ],
      S2: [
        P("Indices and Standard Form", 10, "Laws of indices; standard form; logarithms (intro)", ["Apply laws of indices to simplify expressions", "Use standard form in science contexts"]),
        P("Ratio, Proportion and Rates", 10, "Direct and inverse proportion; rates; scale drawing", ["Solve proportion problems", "Apply rates in real life (speed, density, cost)"]),
        P("Linear Equations and Graphs", 12, "Gradient; equation of a line; simultaneous equations", ["Draw and interpret straight-line graphs", "Solve simultaneous equations graphically and algebraically"]),
        P("Pythagoras and Trigonometry", 12, "Pythagoras theorem; trigonometric ratios; elevation and depression", ["Apply Pythagoras theorem", "Use trigonometric ratios to solve problems"]),
        P("Geometric Constructions", 10, "Bisectors; loci; constructions with ruler and compasses", ["Construct accurate figures", "Sketch loci satisfying given conditions"]),
        P("Business Mathematics", 12, "Simple and compound interest; hire purchase; commission; taxation", ["Compute interest, discount and tax", "Make informed consumer decisions"]),
      ],
      S3: [
        P("Quadratic Expressions and Equations", 14, "Factorisation; completing the square; formula; graphical solutions", ["Factorise quadratic expressions", "Solve quadratic equations by different methods"]),
        P("Coordinate Geometry", 12, "Distance; midpoint; gradient; equations of lines; parallel and perpendicular", ["Apply coordinate geometry to solve problems", "Relate gradient to real gradients"]),
        P("Circle Geometry and Theorems", 14, "Chord, tangent-angle and cyclic quadrilateral theorems", ["Apply circle theorems in proofs", "Construct and justify geometric arguments"]),
        P("Vectors and Transformations", 14, "Vector notation; addition; translation; reflection, rotation, enlargement", ["Represent and operate on vectors", "Describe transformations precisely"]),
        P("Matrices", 12, "Types; addition; multiplication; determinants; inverse (2x2); applications", ["Perform matrix operations", "Use matrices to solve simultaneous equations"]),
        P("Statistics", 12, "Grouped data; histograms; cumulative frequency; mean, median, quartiles", ["Compute and interpret statistics for grouped data", "Draw and use cumulative frequency curves"]),
      ],
      S4: [
        P("Probability", 10, "Mutually exclusive and independent events; tree diagrams; conditional probability", ["Compute probability of compound events", "Apply probability to decision making"]),
        P("Bearings, Scale Drawing and Latitude/Longitude", 12, "Bearings; distance; time zones; great and small circles", ["Solve bearings problems", "Compute distances on the earth's surface"]),
        P("Three-Dimensional Geometry", 14, "Solids; surface area and volume; frustums; projections", ["Compute surface area and volume of solids", "Draw accurate nets and projections"]),
        P("Linear Programming", 10, "Inequalities in two unknowns; feasible regions; optimisation", ["Formulate and solve linear programming problems", "Interpret optimal solutions"]),
        P("Statistics and Data Handling", 12, "Data analysis; scatter diagrams; lines of best fit; correlation", ["Analyse data using scatter diagrams", "Draw conclusions from statistical data"]),
        P("Revision and Examination Practice", 20, "Topic-by-topic revision; past paper technique; timed practice", ["Apply knowledge under examination conditions", "Manage examination time effectively"]),
      ],
    },

    Biology: {
      S1: [
        P("Introduction to Biology", 9, "Meaning of biology; branches; characteristics of living things", ["Distinguish living from non-living things", "Appreciate biology in daily life"]),
        P("Cells and Cell Organisation", 12, "Cell structure; plant and animal cells; cell specialisation; microscopy", ["Use a microscope safely", "Draw and label cell structures"]),
        P("Classification of Living Things", 12, "Five kingdoms; binomial nomenclature; simple keys", ["Classify organisms into kingdoms", "Construct and use identification keys"]),
        P("Nutrition in Plants", 12, "Photosynthesis; mineral requirements; leaf structure; experiments", ["Investigate photosynthesis", "Relate leaf structure to function"]),
        P("Nutrition in Animals", 12, "Modes of feeding; dentition; human digestive system; food tests", ["Carry out food tests", "Relate digestive structures to functions"]),
        P("Plant and Animal Ecology", 12, "Habitat; ecosystem; food chains; adaptations; conservation", ["Investigate a local ecosystem", "Advocate for environmental conservation"]),
      ],
      S2: [
        P("Cell Processes: Transport", 12, "Diffusion; osmosis; active transport; experiments", ["Demonstrate diffusion and osmosis", "Relate transport to cell survival"]),
        P("Respiration", 10, "Aerobic and anaerobic respiration; gaseous exchange; respiration experiments", ["Compare aerobic and anaerobic respiration", "Investigate heat evolution in germinating seeds"]),
        P("Transport in Plants and Animals", 14, "Root hair; xylem and phloem; transpiration; blood; the human heart; circulation", ["Dissect and observe a mammalian heart", "Relate transport structures to function"]),
        P("Gaseous Exchange and Excretion", 12, "Respiratory surfaces; lungs; kidney and nephron; osmoregulation", ["Describe gaseous exchange surfaces", "Explain the role of the kidney"]),
        P("Reproduction in Plants", 12, "Flower structure; pollination; fertilisation; seed and fruit formation; dispersal", ["Dissect flowers and identify parts", "Relate floral structure to pollination"]),
        P("Animal Diversity and Adaptation", 12, "Invertebrates; vertebrates; adaptations to habitats", ["Classify animals using keys", "Relate adaptations to survival"]),
      ],
      S3: [
        P("Classification and Evolution", 12, "Natural classification; variation; natural selection; evidence for evolution", ["Argue a case for evolution", "Analyse variation in a population"]),
        P("Reproduction in Humans", 14, "Male and female reproductive systems; gametes; menstrual cycle; fertilisation; pregnancy; family planning", ["Describe human reproductive processes", "Make informed reproductive health decisions"]),
        P("Growth and Development", 12, "Growth in plants and animals; growth curves; metamorphosis; seed germination", ["Measure and interpret growth", "Investigate seed germination conditions"]),
        P("Genetics", 14, "Mendelian inheritance; monohybrid crosses; sex determination; genetic disorders; blood groups", ["Solve genetic crosses", "Explain inheritance of traits"]),
        P("Ecology and Environment", 14, "Population; competition; succession; human impact; pollution; conservation", ["Investigate human impact on the environment", "Propose conservation measures"]),
        P("Diseases and Immunity", 14, "Pathogens; communicable and non-communicable diseases; body defences; immunisation", ["Identify modes of disease transmission", "Take responsible health measures"]),
      ],
      S4: [
        P("Coordination and Response", 14, "Nervous system; reflex action; sense organs; endocrine system; hormones", ["Explain nervous and hormonal coordination", "Investigate reflex responses"]),
        P("Homeostasis", 12, "Temperature regulation; water and salt balance; blood sugar; feedback mechanisms", ["Explain negative feedback", "Relate homeostasis to health"]),
        P("Support, Movement and Locomotion", 14, "Skeleton; joints; muscles; antagonistic action; plant support", ["Examine bones and joints", "Relate muscle action to movement"]),
        P("Applied Biology", 14, "Agriculture and health applications; biotechnology; genetic engineering; food production", ["Apply biology to agriculture and health", "Evaluate biotechnology benefits and risks"]),
        P("Agriculture (Biology Application)", 12, "Crop and animal production; soil; pests; preservation; sustainable farming", ["Advise on improved farming practices", "Design a small production plan"]),
        P("Revision and Examination Practice", 20, "Theme revision; practical skills; past paper practice", ["Apply practical and theory skills", "Manage examination time"]),
      ],
    },

    Chemistry: {
      S1: [
        P("Introduction to Chemistry", 9, "Meaning of chemistry; laboratory safety; apparatus; measurement", ["Observe laboratory safety rules", "Use apparatus correctly"]),
        P("Matter and Its States", 12, "States of matter; particle theory; changes of state; diffusion", ["Explain changes of state using particles", "Demonstrate diffusion"]),
        P("Separation of Mixtures", 12, "Filtration; evaporation; distillation; chromatography; sublimation", ["Separate mixtures using appropriate methods", "Design a separation procedure"]),
        P("Elements, Compounds and Mixtures", 12, "Atoms; molecules; symbols; formulae; compounds", ["Classify substances correctly", "Write chemical symbols and formulae"]),
        P("Air, Water and Combustion", 12, "Composition of air; water treatment; rusting; combustion; fire control", ["Test for gases", "Explain combustion and fire control"]),
        P("Rates of Reaction (Introductory)", 9, "Factors affecting reaction rates; simple observations", ["Investigate a rate factor", "Record observations accurately"]),
      ],
      S2: [
        P("Atomic Structure and the Periodic Table", 14, "Sub-atomic particles; electron arrangement; groups and periods; trends", ["Relate electron arrangement to position", "Predict properties from the periodic table"]),
        P("Chemical Bonding", 12, "Ionic; covalent; metallic; properties of compounds", ["Draw dot-and-cross diagrams", "Relate bonding to properties"]),
        P("Acids, Bases and Indicators", 12, "pH; indicators; neutralisation; salts; titration (intro)", ["Test acidity and alkalinity", "Prepare a salt by neutralisation"]),
        P("Chemical Equations and the Mole", 14, "Word and symbol equations; balancing; formula mass; the mole concept", ["Write balanced equations", "Carry out mole calculations"]),
        P("Salts and Solubility", 12, "Preparation of salts; solubility rules; crystallisation; water of crystallisation", ["Prepare and purify a salt", "Apply solubility rules"]),
        P("Organic Chemistry: Hydrocarbons", 12, "Alkanes; alkenes; fractional distillation; fuels; pollution", ["Name and draw hydrocarbons", "Evaluate fuel choices"]),
      ],
      S3: [
        P("Quantitative Chemistry", 14, "Molar volume; concentration; titration calculations; gas volumes", ["Perform accurate titrations", "Solve stoichiometric problems"]),
        P("Energetics", 12, "Enthalpy change; exothermic and endothermic; energy level diagrams; bond energy", ["Measure temperature changes", "Draw energy level diagrams"]),
        P("Rates of Reaction and Equilibrium", 14, "Collision theory; catalysts; reversible reactions; Le Chatelier's principle", ["Investigate factors affecting rate", "Apply equilibrium principles"]),
        P("Electrochemistry", 14, "Electrolysis; electrodes; ionic discharge; electroplating; cells", ["Carry out electrolysis", "Explain industrial applications"]),
        P("Metals and Extraction", 14, "Reactivity series; extraction of metals; alloys; corrosion", ["Relate reactivity to extraction", "Investigate corrosion"]),
        P("Non-metals and Their Compounds", 12, "Sulphur; nitrogen; chlorine; ammonia; fertilisers", ["Prepare and test gases", "Explain fertiliser manufacture"]),
      ],
      S4: [
        P("Organic Chemistry: Functional Groups", 14, "Alcohols; carboxylic acids; esters; soaps; polymers", ["Identify functional groups", "Prepare an ester or soap"]),
        P("Qualitative Analysis", 14, "Tests for cations; anions; gases; flame tests", ["Carry out systematic qualitative analysis", "Record results in a table"]),
        P("Industrial Chemistry", 12, "Contact process; Haber process; cement; sugar manufacture", ["Explain industrial processes", "Discuss environmental impacts"]),
        P("Environmental Chemistry", 10, "Air and water pollution; greenhouse gases; waste management; green chemistry", ["Analyse environmental issues", "Propose mitigation measures"]),
        P("Radioactivity", 10, "Radioactive decay; half-life; uses; hazards", ["Solve half-life problems", "Evaluate uses of radioactivity"]),
        P("Revision and Practical Examination Practice", 20, "Theory revision; volumetric and qualitative practicals", ["Perform practicals accurately", "Manage examination time"]),
      ],
    },

    Physics: {
      S1: [
        P("Introduction to Physics", 9, "Branches of physics; measurement; SI units; instruments", ["Use measuring instruments accurately", "Estimate physical quantities"]),
        P("Simple Measurements and Density", 12, "Length; area; volume; mass; density of solids and liquids", ["Determine density experimentally", "Use vernier and micrometer"]),
        P("Force and Pressure", 12, "Force; weight; pressure in solids and fluids; atmospheric pressure", ["Measure pressure", "Relate pressure to area"]),
        P("Particulate Nature of Matter", 12, "Kinetic theory; states of matter; Brownian motion; diffusion", ["Explain phenomena using kinetic theory", "Investigate diffusion"]),
        P("Heat and Temperature", 12, "Temperature scales; thermometers; heat transfer; effects of heat", ["Use thermometers correctly", "Investigate heat transfer"]),
        P("Light and Shadows", 9, "Sources of light; rectilinear propagation; shadows; eclipses; the pinhole camera", ["Construct a pinhole camera", "Explain shadows and eclipses"]),
      ],
      S2: [
        P("Reflection and Refraction of Light", 14, "Plane mirrors; curved mirrors; refraction; lenses; optical instruments", ["Investigate reflection and refraction", "Draw ray diagrams"]),
        P("Electricity: Static and Current", 14, "Charge; circuits; current; voltage; resistance; Ohm's law", ["Build series and parallel circuits", "Measure current and voltage"]),
        P("Magnetism", 12, "Magnets; magnetic fields; electromagnets; the motor effect", ["Map magnetic field lines", "Make an electromagnet"]),
        P("Work, Energy and Machines", 14, "Work; energy forms; conservation; power; simple machines", ["Compute work and energy", "Investigate a simple machine"]),
        P("Sound", 10, "Vibration; wave nature; speed of sound; reflection; echo", ["Measure the speed of sound", "Explain echoes and acoustics"]),
        P("Expansion of Solids, Liquids and Gases", 10, "Linear and volume expansion; anomalous expansion of water; applications", ["Investigate expansion", "Explain expansion applications"]),
      ],
      S3: [
        P("Linear Motion", 14, "Distance; displacement; speed; velocity; acceleration; motion graphs", ["Analyse motion graphs", "Solve motion problems"]),
        P("Newton's Laws of Motion", 14, "Force; inertia; momentum; impulse; collisions", ["Verify Newton's laws", "Apply conservation of momentum"]),
        P("Work, Energy and Power", 12, "Mechanical energy; energy conversion; efficiency; machines", ["Compute efficiency", "Investigate energy conversion"]),
        P("Waves", 12, "Wave properties; transverse and longitudinal; sound and light waves", ["Determine wavelength and frequency", "Relate wave properties to observations"]),
        P("Electricity: Current, Heating and Power", 14, "Resistance; resistivity; electrical heating; power; domestic circuits", ["Determine resistance experimentally", "Compute electricity costs"]),
        P("Electronics", 12, "Semiconductors; diodes; rectification; transistors (intro)", ["Test a diode", "Build a simple rectifier"]),
      ],
      S4: [
        P("Heat Quantities", 14, "Specific heat capacity; latent heat; calorimetry; heat transfer", ["Determine specific heat capacity", "Solve calorimetry problems"]),
        P("Gas Laws", 12, "Boyle's law; Charles' law; pressure law; the ideal gas equation", ["Verify a gas law", "Solve gas law problems"]),
        P("Electromagnetism and Induction", 14, "Magnetic effects of current; transformers; a.c. generator; induction", ["Demonstrate induction", "Explain transformer action"]),
        P("Electromagnetic Spectrum", 10, "Regions; properties; uses; hazards", ["Compare regions of the spectrum", "Evaluate uses and hazards"]),
        P("Radioactivity and Atomic Physics", 12, "Radioactive decay; nuclear energy; fission and fusion; applications", ["Solve decay problems", "Discuss nuclear energy"]),
        P("Revision and Practical Examination Practice", 20, "Theory revision; practical skills and analysis", ["Perform practicals confidently", "Manage examination time"]),
      ],
    },

    English: {
      S1: [
        P("Listening and Speaking", 12, "Pronunciation; stress; intonation; oral presentations", ["Speak audibly and confidently", "Listen for specific information"]),
        P("Reading Comprehension", 14, "Skimming; scanning; inference; vocabulary in context", ["Read for meaning and inference", "Build vocabulary from context"]),
        P("Grammar: Parts of Speech", 14, "Nouns; pronouns; verbs; adjectives; adverbs; prepositions", ["Identify and use parts of speech", "Construct grammatical sentences"]),
        P("Grammar: Tenses", 12, "Simple present and past; continuous; perfect", ["Use tenses accurately", "Narrate events in sequence"]),
        P("Composition Writing", 12, "Narrative; descriptive; paragraphing; punctuation", ["Write coherent paragraphs", "Edit own writing"]),
        P("Literature: Oral and Written", 12, "Folktales; poems; elements of a story; character and setting", ["Appreciate oral literature", "Identify literary elements"]),
      ],
      S2: [
        P("Listening and Speaking: Discussion", 12, "Debate; group discussion; interviews; telephone etiquette", ["Participate in structured discussions", "Use appropriate register"]),
        P("Reading: Intensive and Extensive", 12, "Study reading; library skills; summary writing", ["Summarise a passage", "Read widely for pleasure"]),
        P("Grammar: Sentence Types and Structure", 12, "Simple, compound, complex sentences; clauses; phrases", ["Analyse sentence structure", "Write varied sentences"]),
        P("Functional Writing", 12, "Letters; notices; messages; instructions; forms", ["Write formal and informal letters", "Follow and give instructions"]),
        P("Composition: Argumentative and Expository", 12, "Planning; thesis; supporting evidence; cohesion", ["Write a structured argument", "Use cohesive devices"]),
        P("Literature: Novel and Poetry", 12, "Plot; theme; characterisation; figures of speech", ["Analyse a novel", "Interpret poetry"]),
      ],
      S3: [
        P("Oral Skills: Speeches and Presentations", 12, "Speech writing; delivery; audience awareness", ["Deliver a well-organised speech", "Adapt language to audience"]),
        P("Reading: Critical Reading", 14, "Author's tone; bias; fact and opinion; inference", ["Evaluate a writer's argument", "Distinguish fact from opinion"]),
        P("Grammar: Advanced Usage", 14, "Conditionals; reported speech; passive voice; modal verbs", ["Use advanced structures accurately", "Transform sentences"]),
        P("Writing: Reports and Articles", 12, "Report writing; newspaper articles; reviews", ["Write a factual report", "Write for a specific audience"]),
        P("Literature: Drama and Set Books", 14, "Dramatic techniques; conflict; themes; character development", ["Analyse a play", "Relate literature to society"]),
        P("Comprehension and Summary", 12, "Passage analysis; note making; summary technique", ["Make concise notes", "Write accurate summaries"]),
      ],
      S4: [
        P("Examination Skills: Comprehension", 12, "Question analysis; time management; answer structure", ["Answer comprehension questions precisely", "Manage examination time"]),
        P("Examination Skills: Summary and Grammar", 12, "Summary technique; grammar exercises; error correction", ["Write accurate summaries", "Correct grammatical errors"]),
        P("Composition Mastery", 14, "Narrative; descriptive; argumentative; discursive essays", ["Plan and write high-scoring essays", "Sustain style and tone"]),
        P("Literature: Set Texts Revision", 14, "Theme; character; style; context; essay technique", ["Write literary essays", "Support answers with textual evidence"]),
        P("Functional Writing Mastery", 12, "Formal reports; minutes; CVs; application letters", ["Produce workplace documents", "Use correct format"]),
        P("Revision and Mock Practice", 20, "Full paper practice; marking guides; feedback", ["Apply feedback to improve", "Sit timed papers"]),
      ],
    },

    Geography: {
      S1: [
        P("Introduction to Geography", 9, "Meaning; branches; importance; geography and the environment", ["Explain the value of geography", "Observe features in the local area"]),
        P("The Earth and Its Movements", 12, "Shape and size; rotation and revolution; latitude and longitude; time", ["Locate places using coordinates", "Compute local time"]),
        P("Maps and Map Work", 14, "Scale; direction; grid references; contours; relief", ["Read and interpret maps", "Draw sketch maps"]),
        P("Weather and Climate", 12, "Elements of weather; instruments; recording; weather stations", ["Measure weather elements", "Keep a weather record"]),
        P("The Local Environment", 12, "Relief; drainage; vegetation; soils of the local area", ["Describe the local environment", "Draw a transect"]),
        P("Landforms and Their Formation", 12, "Volcanoes; folding; faulting; earth movements", ["Identify landforms on a map", "Explain formation processes"]),
      ],
      S2: [
        P("Physical Geography: Rocks", 12, "Igneous; sedimentary; metamorphic; rock cycle; economic uses", ["Classify rocks", "Relate rocks to economic activity"]),
        P("Soils", 12, "Soil formation; profile; types; erosion; conservation", ["Examine a soil profile", "Practise soil conservation"]),
        P("Drainage Systems", 14, "Rivers; lakes; drainage patterns; river processes and landforms", ["Explain river processes", "Identify drainage patterns"]),
        P("Climatic Regions of the World", 14, "Equatorial; tropical; desert; Mediterranean; temperate", ["Compare climatic regions", "Relate climate to vegetation"]),
        P("Population", 12, "Growth; distribution; density; migration; census", ["Interpret population data", "Explain migration causes"]),
        P("Agriculture", 14, "Subsistence and commercial; factors; crop and livestock farming", ["Compare farming systems", "Evaluate agricultural practices"]),
      ],
      S3: [
        P("Vegetation of the World", 12, "Natural vegetation types; distribution; human influence", ["Describe vegetation types", "Analyse human impact"]),
        P("Forestry and Fishing", 12, "Types of forests; exploitation; conservation; fishing grounds", ["Evaluate resource exploitation", "Propose conservation strategies"]),
        P("Mining and Energy Resources", 14, "Minerals; mining methods; energy sources; renewable energy", ["Assess mining impacts", "Compare energy sources"]),
        P("Manufacturing Industry", 14, "Types; location factors; industrial regions; industrialisation", ["Explain industrial location", "Discuss industrialisation in Uganda"]),
        P("Transport and Communication", 12, "Modes; advantages and disadvantages; ICT in development", ["Compare transport modes", "Relate transport to development"]),
        P("Trade and Development", 12, "Local, regional and international trade; balance of payments; aid", ["Analyse trade patterns", "Evaluate development indicators"]),
      ],
      S4: [
        P("Map Reading and Photograph Interpretation", 14, "Interpretation skills; statistical diagrams; fieldwork", ["Interpret maps and photographs", "Carry out fieldwork and report"]),
        P("East Africa: Physical and Human Geography", 14, "Relief; drainage; climate; population; economic activities", ["Analyse East African geography", "Apply concepts to the region"]),
        P("Regional Case Studies", 12, "Agriculture, industry and tourism in East Africa", ["Evaluate a regional case study", "Compare with other regions"]),
        P("Environmental Management", 12, "Environmental degradation; conservation; disaster management", ["Analyse environmental problems", "Propose management plans"]),
        P("Fieldwork and Research Skills", 12, "Research design; data collection; analysis; report writing", ["Design a fieldwork study", "Write a research report"]),
        P("Revision and Examination Practice", 20, "Map work, physical and human geography revision", ["Apply skills under exam conditions", "Manage time in exams"]),
      ],
    },

    History: {
      S1: [
        P("Introduction to History", 9, "Meaning; sources; methods; importance of history", ["Identify historical sources", "Explain the value of history"]),
        P("Pre-historic Period", 12, "Stone Age; evolution of man; early technology; rock art", ["Describe the Stone Age periods", "Appreciate early technology"]),
        P("Origin of Agriculture and Iron Working", 12, "Neolithic revolution; iron technology; effects on society", ["Explain the effects of agriculture", "Relate iron working to development"]),
        P("Early States and Kingdoms", 12, "Egypt; Nubia; Kush; organisation and decline", ["Describe features of early states", "Explain factors for growth and decline"]),
        P("The Bantu and Nilotic Migrations", 12, "Causes; routes; effects on East Africa", ["Explain migration causes", "Assess migration effects"]),
        P("British and German Colonisation of East Africa", 12, "Scramble; colonisation; response; administration", ["Explain the scramble for Africa", "Evaluate colonial administration"]),
      ],
      S2: [
        P("The Bantu and Nilotic Migrations (Advanced)", 10, "Causes; routes; settlement; effects", ["Analyse migration patterns", "Relate migrations to modern Uganda"]),
        P("Religious and Long-Distance Trade", 12, "Islam and Christianity; caravan trade; effects on the interior", ["Explain the spread of religions", "Assess trade effects"]),
        P("The Scramble for Africa and Colonisation", 12, "Berlin Conference; partition; resistance; collaboration", ["Explain partition", "Compare resistance and collaboration"]),
        P("Colonial Administration in Uganda", 14, "Baganda agreement; indirect rule; local administration", ["Describe colonial systems", "Evaluate their effects"]),
        P("Resistance and Nationalism", 12, "Primary resistance; independent churches; early political associations", ["Explain resistance movements", "Relate nationalism to independence"]),
        P("The World Wars", 12, "Causes; course; effects on Africa", ["Explain the causes of the wars", "Assess effects on Africa"]),
      ],
      S3: [
        P("Nationalism and the Road to Independence", 14, "Political parties; trade unions; constitutional development", ["Explain the growth of nationalism", "Describe pre-independence politics"]),
        P("Independence of East African States", 12, "Uganda; Kenya; Tanzania; Tanganyika; Zanzibar", ["Compare independence processes", "Evaluate independence constitutions"]),
        P("Post-Independence Politics: Uganda", 14, "1962 to 1986; political crises; coups; military rule", ["Analyse causes of instability", "Explain the restoration of order"]),
        P("East African Co-operation", 12, "East African Community; East African High Commission; revival", ["Explain co-operation attempts", "Evaluate benefits and failures"]),
        P("The Cold War and Africa", 12, "Superpowers; non-alignment; proxy conflicts", ["Explain the Cold War", "Assess its effects on Africa"]),
        P("Pan-Africanism and the OAU/AU", 12, "Origins; leaders; aims; achievements; challenges", ["Explain pan-Africanism", "Evaluate the OAU/AU"]),
      ],
      S4: [
        P("World Civilisation and Major Revolutions", 12, "Industrial revolution; French and Russian revolutions", ["Explain revolution causes", "Assess revolution effects"]),
        P("International Relations and the United Nations", 12, "League of Nations; UN; agencies; peacekeeping", ["Explain UN organs", "Evaluate UN performance"]),
        P("Africa and the World Economy", 12, "Colonial economy; dependency; globalisation", ["Analyse dependency", "Discuss globalisation impacts"]),
        P("Governance, Democracy and Human Rights", 12, "Constitutions; democracy; human rights; the rule of law", ["Explain democratic principles", "Evaluate human rights protection"]),
        P("Regional Case Studies in Development", 12, "Economic and political case studies in Africa", ["Analyse selected case studies", "Draw development lessons"]),
        P("Revision and Examination Practice", 20, "Document-based questions; essays; revision", ["Answer document questions", "Write structured essays"]),
      ],
    },

    Entrepreneurship: {
      S1: [
        P("Introduction to Entrepreneurship", 9, "Meaning; entrepreneur; enterprise; characteristics; importance", ["Define entrepreneurship", "Identify entrepreneurial traits"]),
        P("Creative and Critical Thinking", 12, "Problem solving; idea generation; decision making; opportunity spotting", ["Generate business ideas", "Make reasoned decisions"]),
        P("Business Environment", 12, "Internal and external environment; stakeholders; ethics", ["Analyse a business environment", "Act ethically"]),
        P("Enterprise Idea and Opportunity", 12, "Scanning for opportunities; market gaps; feasibility", ["Identify a viable idea", "Test an idea with customers"]),
        P("Personal Financial Literacy", 12, "Income; saving; budgeting; money discipline", ["Prepare a personal budget", "Save for a goal"]),
        P("Communication in Business", 9, "Verbal and non-verbal; business etiquette; networking", ["Communicate professionally", "Build a network"]),
      ],
      S2: [
        P("Business Ownership and Legal Forms", 12, "Sole proprietorship; partnership; companies; co-operatives", ["Compare business forms", "Register a simple business"]),
        P("Marketing", 14, "Market research; the 4Ps; pricing; promotion; distribution", ["Carry out market research", "Design a promotional mix"]),
        P("Business Records", 14, "Books of account; receipts; invoices; simple statements", ["Keep simple business records", "Interpret a statement"]),
        P("Production", 12, "Factors of production; production process; quality; productivity", ["Plan a production process", "Improve productivity"]),
        P("Business Finance", 12, "Sources of finance; cost of capital; budgeting", ["Identify funding sources", "Prepare a simple budget"]),
        P("Human Resource Management", 12, "Recruitment; motivation; teamwork; appraisal", ["Explain HRM functions", "Work effectively in a team"]),
      ],
      S3: [
        P("Business Planning", 14, "Business plan components; feasibility study; risk analysis", ["Prepare a business plan", "Assess business risk"]),
        P("Taxation and Insurance", 12, "Types of taxes; tax compliance; insurance principles; policies", ["Compute simple tax", "Explain insurance benefits"]),
        P("Financial Statements", 14, "Income statement; statement of financial position; ratios", ["Prepare simple financial statements", "Interpret ratios"]),
        P("Business Ethics and Social Responsibility", 12, "Ethical issues; consumer protection; CSR; sustainability", ["Apply ethical practices", "Design a CSR activity"]),
        P("International Trade and Globalisation", 12, "Exports and imports; trade documents; e-commerce", ["Explain trade documentation", "Sell online responsibly"]),
        P("Business Growth and Survival", 12, "Expansion; diversification; innovation; challenges", ["Propose a growth strategy", "Manage a business challenge"]),
      ],
      S4: [
        P("Project Planning and Management", 14, "Project cycle; scheduling; resources; monitoring", ["Plan a school project", "Monitor project progress"]),
        P("Enterprise Project Implementation", 16, "Implementation; record keeping; evaluation; reporting", ["Run a mini enterprise", "Evaluate project outcomes"]),
        P("Technology and Innovation in Business", 12, "Digital tools; e-commerce; mobile money; digital marketing", ["Use digital tools for business", "Design a digital campaign"]),
        P("Career Development", 12, "Career paths; job search; CV and interview; self-employment", ["Prepare a CV", "Plan a career path"]),
        P("Consumer and Business Law", 12, "Contracts; warranties; consumer rights; dispute resolution", ["Explain a simple contract", "Uphold consumer rights"]),
        P("Revision and Project Assessment", 20, "Revision; enterprise project presentation", ["Present an enterprise project", "Apply knowledge in exams"]),
      ],
    },

    "Computer Studies": {
      S1: [
        P("Introduction to Computers", 9, "Computer meaning; parts; uses; computer care", ["Identify computer parts", "Care for computer equipment"]),
        P("Computer Hardware", 12, "Input; output; processing; storage devices; peripherals", ["Connect peripherals correctly", "Classify devices"]),
        P("Computer Software", 12, "System and application software; operating systems; file management", ["Use an operating system", "Manage files and folders"]),
        P("Health and Safety in Computing", 9, "Posture; ergonomics; E-waste; cyber hygiene", ["Practise safe computing", "Dispose of e-waste responsibly"]),
        P("Word Processing", 14, "Document creation; formatting; tables; printing", ["Create a formatted document", "Use word processing tools"]),
        P("The Internet and Email", 12, "Browsing; search; email; netiquette; online safety", ["Search the web effectively", "Send a professional email"]),
      ],
      S2: [
        P("Spreadsheets", 14, "Cells; formulae; functions; charts; data analysis", ["Build a spreadsheet model", "Create charts from data"]),
        P("Databases", 14, "Database concepts; tables; records; queries; reports", ["Create a simple database", "Query and report data"]),
        P("Presentation Software", 12, "Slide design; animations; delivery; presentation skills", ["Design effective slides", "Deliver a presentation"]),
        P("Graphics and Multimedia", 12, "Bitmap and vector graphics; audio and video editing", ["Create a graphic", "Edit simple multimedia"]),
        P("Computer Networks", 12, "Network types; topology; devices; the school network", ["Explain network types", "Share resources on a network"]),
        P("Programming Fundamentals", 14, "Algorithms; flowcharts; sequence, selection, iteration; pseudocode", ["Design an algorithm", "Write a simple program"]),
      ],
      S3: [
        P("Programming in a High-Level Language", 16, "Variables; data types; control structures; functions; debugging", ["Write and debug programs", "Document code"]),
        P("Data Representation", 12, "Number systems; binary arithmetic; character coding; units", ["Convert between number systems", "Perform binary arithmetic"]),
        P("Systems Development", 14, "SDLC; requirements; design; implementation; testing", ["Analyse a system", "Design a solution"]),
        P("Web Design and Development", 16, "HTML; CSS; structure; content; publishing", ["Build a simple web page", "Publish content online"]),
        P("Computer Security and Ethics", 12, "Threats; malware; passwords; ethical use", ["Apply security measures", "Observe computer ethics"]),
        P("Emerging Technologies", 12, "Mobile computing; cloud; AI; IoT; their impact", ["Explain emerging technologies", "Assess their impact"]),
      ],
      S4: [
        P("Advanced Programming and Algorithms", 16, "Sorting; searching; file handling; modular design", ["Implement common algorithms", "Write modular code"]),
        P("Database Design and Management", 14, "Normalisation; relationships; SQL; data integrity", ["Normalise a database", "Write SQL queries"]),
        P("Networking and Internet Technologies", 14, "IP addressing; protocols; services; the cloud", ["Explain TCP/IP basics", "Configure simple settings"]),
        P("ICT Project Development", 16, "Project proposal; development; documentation; presentation", ["Develop an ICT project", "Present project work"]),
        P("ICT in Society and Employment", 12, "ICT in business, education, health; digital careers", ["Apply ICT in a sector", "Plan a digital career"]),
        P("Revision and Practical Examination Practice", 20, "Theory revision; practical projects; past papers", ["Demonstrate practical skills", "Manage examination time"]),
      ],
    },

    Agriculture: {
      S1: [
        P("Introduction to Agriculture", 9, "Meaning; branches; importance; agriculture and the environment", ["Explain the role of agriculture", "Identify farm enterprises"]),
        P("Soil and Soil Fertility", 14, "Soil formation; profile; types; fertility; fertilisers", ["Test soil characteristics", "Apply fertiliser correctly"]),
        P("Crop Production: Cereals and Legumes", 14, "Land preparation; planting; management; harvesting", ["Raise a cereal crop", "Keep a crop record"]),
        P("Vegetable Production", 12, "Nursery; transplanting; pest control; harvesting", ["Raise vegetables", "Manage a kitchen garden"]),
        P("Farm Tools and Equipment", 12, "Hand tools; care; safety; simple maintenance", ["Use tools safely", "Maintain farm tools"]),
        P("Livestock Introduction", 12, "Types of livestock; breeds; housing; routine care", ["Identify breeds", "Carry out routine care"]),
      ],
      S2: [
        P("Soil and Water Conservation", 12, "Erosion; conservation measures; irrigation; drainage", ["Design a conservation measure", "Irrigate a plot"]),
        P("Crop Husbandry: Root and Tuber Crops", 14, "Cassava; sweet potato; Irish potato; management", ["Grow a root crop", "Compare yields"]),
        P("Poultry Keeping", 14, "Breeds; housing; feeding; disease control; marketing", ["Manage a poultry unit", "Compute poultry feed rations"]),
        P("Farm Structures", 12, "Animal houses; stores; fencing; farmstead planning", ["Design a farm structure", "Erect a simple structure"]),
        P("Pests, Diseases and Weeds", 14, "Identification; control methods; integrated pest management", ["Identify a pest or disease", "Apply IPM"]),
        P("Farm Records and Marketing", 12, "Types of records; costing; pricing; marketing channels", ["Keep farm records", "Cost a farm enterprise"]),
      ],
      S3: [
        P("Animal Nutrition", 14, "Nutrients; feeds; ration formulation; feeding practices", ["Formulate a simple ration", "Feed animals correctly"]),
        P("Livestock Health", 12, "Common diseases; symptoms; treatment; vaccination", ["Recognise disease symptoms", "Apply disease control"]),
        P("Crop Rotation and Farming Systems", 12, "Rotation; intercropping; agroforestry; organic farming", ["Design a rotation", "Compare farming systems"]),
        P("Agricultural Economics", 14, "Costs; returns; profit; budgeting; credit", ["Prepare an enterprise budget", "Assess profitability"]),
        P("Agricultural Engineering", 14, "Irrigation systems; processing; storage; mechanisation", ["Operate a simple machine", "Store produce safely"]),
        P("Agro-processing and Value Addition", 12, "Processing methods; packaging; quality; marketing", ["Process a product", "Package for market"]),
      ],
      S4: [
        P("Farm Business Management", 14, "Planning; budgeting; records analysis; decision making", ["Prepare a farm plan", "Analyse records"]),
        P("Sustainable Agriculture", 12, "Conservation agriculture; climate-smart farming; land use", ["Apply climate-smart practices", "Assess sustainability"]),
        P("Agricultural Extension and Policy", 12, "Extension methods; farmer groups; agricultural policy", ["Explain extension services", "Discuss policy effects"]),
        P("Post-harvest Handling", 14, "Harvesting; drying; storage; losses; food security", ["Reduce post-harvest losses", "Store produce properly"]),
        P("Field/Enterprise Project", 16, "Planning, implementing and evaluating a project", ["Implement an agriculture project", "Evaluate and report"]),
        P("Revision and Practical Examination Practice", 20, "Theory revision; practical skills; past papers", ["Demonstrate practical skills", "Manage examination time"]),
      ],
    },
  };

  CU.syllabus = SYL;
  CU.subjects = Object.keys(SYL);
  CU.levels = ["S1", "S2", "S3", "S4"];

  /* ------------------------------------------------------- pedagogy banks */
  const METHODS = [
    "Brainstorming", "Guided discovery", "Group work", "Think-pair-share",
    "Demonstration", "Role play", "Discussion", "Question and answer",
    "Project work", "Practical activity", "Case study", "Gallery walk",
  ];
  const MATERIALS = {
    default: ["Charts", "Markers and manila", "Textbook (NCDC approved)", "Learner's exercise books", "Past paper questions"],
    Sciences: ["Laboratory apparatus", "Specimens/models", "Charts and diagrams", "Safety gear", "Digital simulation"],
    Mathematics: ["Geometric set", "Graph paper", "Flash cards", "Calculator (where allowed)", "Charts"],
    Languages: ["Dictionary", "Newspaper extracts", "Audio recording", "Grammar charts", "Set texts"],
    Humanities: ["Wall maps", "Atlas", "Document extracts", "Video clip", "Charts"],
    ICT: ["Computers", "Projector", "Software", "Digital handouts", "Internet (where available)"],
    Vocational: ["Tools and materials", "Samples", "Protective wear", "Charts", "Field visit"],
  };
  const LIFE_SKILLS = [
    "Critical thinking", "Problem solving", "Communication", "Teamwork",
    "Self-esteem", "Decision making", "Creativity and innovation",
    "Time management", "Leadership", "Empathy", "Resilience",
  ];
  const VALUES = [
    "Respect for others' views", "Integrity and honesty", "Responsibility",
    "Co-operation", "Appreciation of diversity", "Care for the environment",
    "Patriotism", "Self-discipline",
  ];
  const ASSESS = [
    "Observation checklist", "Oral questions", "Written exercise",
    "Group presentation", "Practical task", "Peer assessment",
    "Self-assessment", "Project-based assessment", "Class test",
  ];

  function pickBank(dept) { return MATERIALS[dept] || MATERIALS.default; }

  function deptOf(subject) {
    for (const d of Object.keys(MATERIALS)) {
      if (d === subject) return d;
    }
    if (/Bio|Chem|Phys|Agric/.test(subject)) return "Sciences";
    if (/Math/.test(subject)) return "Mathematics";
    if (/English|Literature|Kiswahili|French/.test(subject)) return "Languages";
    if (/Hist|Geo|CRE|IRE|Entrepreneur/.test(subject)) return "Humanities";
    if (/Computer|ICT/.test(subject)) return "ICT";
    if (/Art|Music|PE|Technology/.test(subject)) return "Vocational";
    return "default";
  }
  CU.deptOf = deptOf;

  /* ----------------------------------------------------- topic resolution */
  CU.topics = function (subject, level) {
    const s = SYL[subject];
    if (!s) return [];
    return s[level] || s[S1fallback(level)] || [];
  };
  function S1fallback(level) { return ["S1", "S2", "S3", "S4"].indexOf(level) >= 2 ? "S3" : "S1"; }

  /* ------------------------------------------------------ scheme of work */
  // Distributes the syllabus across teaching weeks, weighted by periods so the
  // plan is realistic, and matches the school's own periods-per-week.
  CU.scheme = function (o) {
    const topics = CU.topics(o.subject, o.level);
    const weeks = o.weeks || 9;
    const perWeek = o.periodsPerWeek || 4;
    const dept = deptOf(o.subject);
    const materials = pickBank(dept);

    // expand topics into week blocks
    const blocks = [];
    let cursor = 0;
    const totalPeriods = CP.sum(topics, (t) => t.periods) || 1;
    const totalWeeks = weeks;
    const usable = Math.max(1, totalWeeks - (o.revisionWeeks || 1));
    topics.forEach((t, i) => {
      const w = Math.max(1, Math.round((t.periods / totalPeriods) * usable));
      blocks.push({ topic: t, weeks: w, index: i });
    });
    // normalise total weeks
    let sum = CP.sum(blocks, (b) => b.weeks);
    let k = 0;
    while (sum > usable && blocks.length) {
      const b = blocks[k % blocks.length];
      if (b.weeks > 1) { b.weeks--; sum--; }
      k++;
      if (k > 200) break;
    }
    while (sum < usable) { blocks[blocks.length - 1].weeks++; sum++; }

    const rows = [];
    let week = 1;
    blocks.forEach((b) => {
      const t = b.topic;
      const per = Math.max(2, Math.round((t.periods / Math.max(1, t.weeks)) ));
      rows.push({
        week,
        span: b.weeks,
        periods: t.periods,
        topic: t.topic,
        subtopics: t.content,
        competences: t.comps,
        outcomes: {
          knowledge: ["Explain " + t.topic.toLowerCase() + " concepts correctly"],
          skills: ["Apply " + t.topic.toLowerCase() + " skills to solve given tasks"],
          values: [VALUES[week % VALUES.length]],
        },
        methods: [METHODS[week % METHODS.length], METHODS[(week + 3) % METHODS.length]],
        materials: materials.slice(0, 4),
        lifeSkills: [LIFE_SKILLS[week % LIFE_SKILLS.length], LIFE_SKILLS[(week + 4) % LIFE_SKILLS.length]],
        assessment: [ASSESS[week % ASSESS.length], ASSESS[(week + 2) % ASSESS.length]],
        references: ["NCDC " + o.subject + " Syllabus (" + o.level + ")", "NCDC Teachers' Guide — " + o.subject, "Approved " + o.subject + " textbook"],
        remarks: "",
      });
      week += b.weeks;
    });

    // revision weeks
    for (let r = 0; r < (o.revisionWeeks == null ? 1 : o.revisionWeeks); r++) {
      rows.push({
        week: week++,
        span: 1,
        periods: perWeek,
        topic: "Revision, Assessment and Feedback",
        subtopics: "End-of-term revision; topical tests; feedback and remediation",
        competences: ["Consolidate term competences", "Set and achieve personal improvement targets"],
        outcomes: {
          knowledge: ["Recall and connect key concepts of the term"],
          skills: ["Answer examination-style questions independently"],
          values: ["Perseverance and honesty in assessment"],
        },
        methods: ["Question and answer", "Class test", "Feedback session"],
        materials: ["Past paper questions", "Marking guides"],
        lifeSkills: ["Time management", "Critical thinking"],
        assessment: ["End of term examination", "Self-assessment"],
        references: ["NCDC Sample assessment items"],
        remarks: "Set holiday work based on areas of weakness.",
      });
    }

    return {
      meta: {
        subject: o.subject, level: o.level, class: o.className || o.level,
        term: o.term || "Term II", year: o.year || new Date().getFullYear(),
        teacher: o.teacherName || "", periodsPerWeek: perWeek, weeks: week - 1,
        generated: new Date().toISOString(),
      },
      rows,
    };
  };

  /* --------------------------------------------------------- lesson plan */
  CU.lessonPlan = function (o) {
    const dept = deptOf(o.subject);
    const materials = pickBank(dept);
    const topic = o.topic || "Topic";
    const sub = o.subtopic || (o.content || "").split(/[;.]/).filter(Boolean)[0] || topic;
    const comps = o.competences && o.competences.length ? o.competences
      : ["Apply " + topic.toLowerCase() + " knowledge to real-life situations", "Work co-operatively in groups"];
    const periodCount = o.periods || 1;
    const minutes = periodCount * 40;
    const steps = buildSteps(o, sub, minutes);

    return {
      meta: {
        school: (CP.store && CP.store.data && CP.store.data.school.name) || "",
        subject: o.subject, class: o.className || o.level, level: o.level,
        topic, subtopic: sub, periods: periodCount, durationMin: minutes,
        date: o.date || CP.time.dayKey(CP.store ? CP.store.now() : new Date()),
        time: o.time || "", week: o.week || "", period: o.period || "",
        teacher: o.teacherName || "", roll: o.roll || "",
        term: o.term || "Term II",
        generated: new Date().toISOString(),
      },
      competences: comps,
      outcomes: {
        knowledge: ["State/describe " + topic.toLowerCase() + " concepts accurately", "Explain " + sub.toLowerCase() + " using correct terminology"],
        skills: ["Apply " + topic.toLowerCase() + " skills in given tasks", "Record and present results accurately"],
        values: [VALUES[(o.period || 3) % VALUES.length], "Willingness to learn from others"],
      },
      prerequisites: [
        "Knowledge of " + prevTopicHint(o.subject, o.level, topic),
        "Basic literacy and numeracy skills",
        "Ability to work in groups",
      ],
      materials: materials.slice(0, 5),
      method: [METHODS[(o.period || 1) % METHODS.length], METHODS[((o.period || 1) + 5) % METHODS.length], "Question and answer"],
      lifeSkills: [LIFE_SKILLS[(o.period || 1) % LIFE_SKILLS.length], LIFE_SKILLS[((o.period || 1) + 6) % LIFE_SKILLS.length]],
      references: ["NCDC " + o.subject + " syllabus (" + o.level + ")", "NCDC Teachers' Guide — " + o.subject, "Approved " + o.subject + " textbook"],
      steps,
      assessment: {
        strategies: [ASSESS[(o.period || 1) % ASSESS.length], "Oral questions during the lesson"],
        criteria: comps[0],
        rationale: "Learners who meet the criteria move on; those who do not get remedial work.",
      },
      differential: [
        "Fast learners: extension task using " + sub.toLowerCase() + " in a new context",
        "Slow learners: guided practice with the teacher",
        "Learners with special needs: seated near the front, simplified task sheet",
      ],
      reflection: "",
      homework: "Exercise on " + sub.toLowerCase() + " (see approved textbook).",
      eResources: CU.eResources(o.subject, topic),
    };
  };

  function prevTopicHint(subject, level, topic) {
    const list = CU.topics(subject, level);
    const i = list.findIndex((t) => t.topic === topic);
    if (i > 0) return list[i - 1].topic.toLowerCase();
    return "preceding classwork";
  }

  function buildSteps(o, sub, minutes) {
    const intro = Math.round(minutes * 0.15);
    const concl = Math.round(minutes * 0.15);
    const mid = minutes - intro - concl;
    const subItems = String(o.content || sub).split(/[;]/).map((s) => s.trim()).filter(Boolean);
    const parts = subItems.length >= 3 ? subItems.slice(0, 4) : [sub, sub + " — worked examples", sub + " — guided practice"];
    const share = Math.floor(mid / parts.length);
    const steps = [];
    steps.push({
      phase: "Introduction", minutes: intro,
      teacher: [
        "Greet learners and create a learner-friendly environment.",
        "Review last lesson using oral questions.",
        "Introduce today's topic and share the learning outcomes in simple language.",
        "State success criteria on the chalkboard/board.",
      ],
      learner: [
        "Respond to questions; share prior experiences.",
        "Write the topic and outcomes in their books.",
        "Ask clarifying questions.",
      ],
    });
    parts.forEach((p, i) => {
      steps.push({
        phase: (i === 0 ? "Development 1" : "Development " + (i + 1)) + ": " + p.replace(/\(.*?\)/g, "").slice(0, 46),
        minutes: share,
        teacher: [
          "Guide learners to discover the key ideas about " + p.replace(/\(.*?\)/g, "").trim().toLowerCase() + ".",
          "Demonstrate/model with a worked example on the board.",
          "Move around the class supporting groups; ask probing questions.",
          "Correct misconceptions as they arise and give clear feedback.",
        ],
        learner: [
          "Work in pairs/groups on the given task.",
          "Share ideas and ask questions.",
          "Record their work in exercise books; present findings to the class.",
          "Self-assess using the success criteria.",
        ],
      });
    });
    steps.push({
      phase: "Conclusion", minutes: concl,
      teacher: [
        "Summarise the main points with learner input.",
        "Give a short written exercise / exit task.",
        "Link the lesson to real life and the next lesson.",
        "Give clear homework instructions and mark as learners leave.",
      ],
      learner: [
        "State what they have learnt in their own words.",
        "Attempt the exercise independently.",
        "Record homework correctly.",
      ],
    });
    return steps;
  }

  /* --------------------------------------------------------- e-resources */
  const ERES = {
    Mathematics: [
      ["Khan Academy — Mathematics", "https://www.khanacademy.org/math"],
      ["PhET Interactive Simulations — Maths", "https://phet.colorado.edu/en/simulations/filter?subjects=math"],
      ["GeoGebra", "https://www.geogebra.org/"],
    ],
    Biology: [
      ["Khan Academy — Biology", "https://www.khanacademy.org/science/biology"],
      ["PhET — Biology simulations", "https://phet.colorado.edu/en/simulations/filter?subjects=biology"],
      ["BioDigital Human (3D anatomy)", "https://human.biodigital.com/"],
    ],
    Chemistry: [
      ["Khan Academy — Chemistry", "https://www.khanacademy.org/science/chemistry"],
      ["PhET — Chemistry simulations", "https://phet.colorado.edu/en/simulations/filter?subjects=chemistry"],
      ["Royal Society of Chemistry — Periodic Table", "https://www.rsc.org/periodic-table"],
    ],
    Physics: [
      ["Khan Academy — Physics", "https://www.khanacademy.org/science/physics"],
      ["PhET — Physics simulations", "https://phet.colorado.edu/en/simulations/filter?subjects=physics"],
      ["The Physics Classroom", "https://www.physicsclassroom.com/"],
    ],
    English: [
      ["British Council LearnEnglish", "https://learnenglish.britishcouncil.org/"],
      ["Khan Academy — Grammar", "https://www.khanacademy.org/humanities/grammar"],
      ["Project Gutenberg (free e-books)", "https://www.gutenberg.org/"],
    ],
    Geography: [
      ["National Geographic Education", "https://education.nationalgeographic.org/"],
      ["USGS — Maps and data", "https://www.usgs.gov/products/maps"],
      ["Google Earth", "https://earth.google.com/web/"],
    ],
    History: [
      ["Khan Academy — World History", "https://www.khanacademy.org/humanities/world-history"],
      ["Internet History Sourcebooks", "https://sourcebooks.fordham.edu/"],
      ["African History Archive", "https://www.aluka.org/"],
    ],
    Entrepreneurship: [
      ["Khan Academy — Finance & capital markets", "https://www.khanacademy.org/economics-finance-domain"],
      ["ILO Start and Improve Your Business", "https://www.ilo.org/siyb"],
    ],
    "Computer Studies": [
      ["Code.org", "https://code.org/"],
      ["Scratch", "https://scratch.mit.edu/"],
      ["W3Schools", "https://www.w3schools.com/"],
    ],
    Agriculture: [
      ["FAO e-learning Academy", "https://elearning.fao.org/"],
      ["Access Agriculture (farmer videos)", "https://www.accessagriculture.org/"],
    ],
  };

  CU.eResources = function (subject, topic) {
    const base = ERES[subject] || [
      ["Kolibri — free offline learning library", "https://learningequality.org/kolibri/"],
      ["Khan Academy", "https://www.khanacademy.org/"],
    ];
    const out = base.map(([label, url]) => ({ label, url }));
    out.push({ label: "Search '" + topic + " " + subject + "' on Kolibri / YouTube", url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(topic + " " + subject + " lesson") });
    out.push({ label: "NCDC Uganda — curriculum & materials", url: "https://www.ncdc.go.ug/" });
    return out;
  };

  /* ------------------------------------------------------- record of work */
  CU.recordOfWork = function (entries) {
    return entries.map((e, i) => ({
      no: i + 1,
      date: e.date, period: e.period, class: e.classId, subject: e.subject,
      topic: e.topic || "", subtopic: e.subtopic || "",
      remarks: e.remarks || (e.state === "on-time" ? "Taught as planned." : e.state === "late" ? "Started late by " + (e.minsLate || 0) + " min." : "Not covered — " + (e.note || "no record")),
      status: e.state,
    }));
  };

  /* ---------------------------------------------------- syllabus coverage */
  // How much of the planned scheme has actually been delivered.
  CU.coverage = function (o) {
    const scheme = CU.scheme(o);
    const done = (o.deliveredTopics || []).reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m; }, {});
    let planned = 0, delivered = 0;
    const rows = scheme.rows.map((r) => {
      planned++;
      const d = done[r.topic] || 0;
      if (d) delivered++;
      return { topic: r.topic, week: r.week, delivered: !!d, periods: r.periods };
    });
    return { planned, delivered, pct: CP.pct(delivered, planned), rows };
  };

  /* ------------------------------------------------------- markdown export */
  CU.schemeToText = function (s) {
    const m = s.meta;
    let out = `SCHEME OF WORK — ${m.subject} ${m.level}\n`;
    out += `${m.term} ${m.year} | Teacher: ${m.teacher} | ${m.periodsPerWeek} periods/week | Weeks: ${m.weeks}\n`;
    out += `Generated by ClassPulse on ${new Date(m.generated).toLocaleString()}\n`;
    out += `${"=".repeat(78)}\n\n`;
    s.rows.forEach((r) => {
      out += `WEEK ${r.week}  [${r.periods} periods]\n`;
      out += `  TOPIC        : ${r.topic}\n`;
      out += `  SUB-TOPICS   : ${r.subtopics}\n`;
      out += `  COMPETENCES  : ${r.competences.join("; ")}\n`;
      out += `  OUTCOMES     : K: ${r.outcomes.knowledge.join("; ")} | S: ${r.outcomes.skills.join("; ")} | V: ${r.outcomes.values.join("; ")}\n`;
      out += `  METHODS      : ${r.methods.join(", ")}\n`;
      out += `  MATERIALS    : ${r.materials.join(", ")}\n`;
      out += `  LIFE SKILLS  : ${r.lifeSkills.join(", ")}\n`;
      out += `  ASSESSMENT   : ${r.assessment.join(", ")}\n`;
      out += `  REFERENCES   : ${r.references.join(", ")}\n`;
      out += `  REMARKS      : ${r.remarks || "-"}\n\n`;
    });
    out += `\n${CU.NCDC_NOTE}\n`;
    return out;
  };

  CU.planToText = function (p) {
    const m = p.meta;
    let out = ``;
    out += `${m.school}\nLESSON PLAN (NCDC Competency-Based)\n${"-".repeat(72)}\n`;
    out += `Subject      : ${m.subject}\nClass        : ${m.class}\nTerm         : ${m.term}\n`;
    out += `Week / Period: ${m.week} / ${m.period}\nDate         : ${m.date}   Time: ${m.time}\n`;
    out += `Duration     : ${m.durationMin} minutes (${m.periods} period${m.periods > 1 ? "s" : ""})\n`;
    out += `Teacher      : ${m.teacher}\nRoll / Attend: ${m.roll}\n`;
    out += `Topic        : ${m.topic}\nSub-topic    : ${m.subtopic}\n`;
    out += `\nSUBJECT COMPETENCES\n${p.competences.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}\n`;
    out += `\nLEARNING OUTCOMES\n  Knowledge : ${p.outcomes.knowledge.join("; ")}\n  Skills    : ${p.outcomes.skills.join("; ")}\n  Values    : ${p.outcomes.values.join("; ")}\n`;
    out += `\nPRE-REQUISITE KNOWLEDGE / SKILLS\n${p.prerequisites.map((c) => `  - ${c}`).join("\n")}\n`;
    out += `\nINSTRUCTIONAL MATERIALS\n  ${p.materials.join(", ")}\n`;
    out += `\nMETHODS / TECHNIQUES\n  ${p.method.join(", ")}\n`;
    out += `\nLIFE SKILLS\n  ${p.lifeSkills.join(", ")}\n`;
    out += `\nLESSON PROCEDURE\n`;
    p.steps.forEach((s) => {
      out += `\n  ${s.phase.toUpperCase()}  (${s.minutes} min)\n`;
      out += `    Teacher's activity:\n${s.teacher.map((t) => "      - " + t).join("\n")}\n`;
      out += `    Learner's activity:\n${s.learner.map((t) => "      - " + t).join("\n")}\n`;
    });
    out += `\nASSESSMENT\n  Strategies : ${p.assessment.strategies.join(", ")}\n  Criteria   : ${p.assessment.criteria}\n  Rationale  : ${p.assessment.rationale}\n`;
    out += `\nLEARNER DIFFERENTIATION\n${p.differential.map((d) => "  - " + d).join("\n")}\n`;
    out += `\nE-RESOURCES\n${p.eResources.map((r) => "  - " + r.label + ": " + r.url).join("\n")}\n`;
    out += `\nHOMEWORK\n  ${p.homework}\n`;
    out += `\nSELF-EVALUATION / REFLECTION\n  ${p.reflection || "______________________________________________"}\n`;
    out += `\n${CU.NCDC_NOTE}\n`;
    return out;
  };

  CU.printable = function (title, text) {
    const w = window.open("", "_blank");
    if (!w) { CP.toast({ kind: "err", msg: "Allow pop-ups to print." }); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>${CP.esc(title)}</title>
      <style>
        body{font:12px/1.5 "Segoe UI",system-ui,sans-serif;margin:26px;color:#111;max-width:820px}
        pre{white-space:pre-wrap;font-family:inherit;font-size:12px}
        h1{font-size:16px;margin:0 0 4px}
        .hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:14px}
        .seg{margin:10px 0 2px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:10.5px;color:#444}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #999;padding:4px 6px;vertical-align:top}
        @media print{body{margin:10mm}}
      </style></head><body>
      <div class="hdr"><div><h1>${CP.esc(title)}</h1>
        <div style="font-size:10.5px;color:#555">Generated by ClassPulse · ${new Date().toLocaleString()}</div></div>
        <div style="font-size:10.5px;text-align:right">${CP.esc((CP.store.data.school || {}).name || "")}<br>${CP.esc((CP.store.data.school || {}).term || "")}</div></div>
      <pre>${CP.esc(text)}</pre>
      <script>setTimeout(function(){window.print()},350)<\/script>
      </body></html>`);
    w.document.close();
  };
})(window);
