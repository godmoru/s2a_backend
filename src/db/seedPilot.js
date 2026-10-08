require("dotenv").config();
const pool = require("./pool");
const { recordAuditEvent } = require("../services/audit.service");

const pilotQuizzes = [
  {
    key: "s2a-pilot-african-geography",
    title: "African Geography",
    description: "Countries, landmarks, rivers, and regional geography.",
    startInMinutes: 45,
    durationMinutes: 30,
    expectedParticipants: 40,
    maxParticipants: 80,
    questions: [
      { prompt: "Which African country is completely surrounded by South Africa?", options: ["Eswatini", "Lesotho", "Botswana", "Namibia"], correctOption: 1 },
      { prompt: "What is the largest lake in Africa by surface area?", options: ["Lake Tanganyika", "Lake Malawi", "Lake Victoria", "Lake Chad"], correctOption: 2 },
      { prompt: "Which river flows through Cairo?", options: ["Niger", "Congo", "Zambezi", "Nile"], correctOption: 3 },
      { prompt: "Mount Kilimanjaro is located in which country?", options: ["Kenya", "Tanzania", "Uganda", "Ethiopia"], correctOption: 1 },
    ],
  },
  {
    key: "s2a-pilot-nigerian-history",
    title: "Nigerian History",
    description: "Key dates, people, and events in Nigerian history.",
    startInMinutes: 150,
    durationMinutes: 45,
    expectedParticipants: 60,
    maxParticipants: 80,
    questions: [
      { prompt: "In what year did Nigeria gain independence?", options: ["1957", "1960", "1963", "1966"], correctOption: 1 },
      { prompt: "Who became Nigeria's first prime minister after independence?", options: ["Nnamdi Azikiwe", "Ahmadu Bello", "Abubakar Tafawa Balewa", "Obafemi Awolowo"], correctOption: 2 },
      { prompt: "Which city was Nigeria's capital before Abuja?", options: ["Kano", "Ibadan", "Enugu", "Lagos"], correctOption: 3 },
      { prompt: "Nigeria became a republic in which year?", options: ["1960", "1963", "1966", "1979"], correctOption: 1 },
    ],
  },
  {
    key: "s2a-pilot-general-science",
    title: "General Science",
    description: "A short challenge in biology, chemistry, and physics.",
    startInMinutes: 1440,
    durationMinutes: 60,
    expectedParticipants: 80,
    maxParticipants: 120,
    questions: [
      { prompt: "What is the chemical symbol for sodium?", options: ["So", "S", "Na", "N"], correctOption: 2 },
      { prompt: "Which part of a plant cell carries out photosynthesis?", options: ["Nucleus", "Chloroplast", "Ribosome", "Vacuole"], correctOption: 1 },
      { prompt: "What is the SI unit of electric current?", options: ["Volt", "Ohm", "Watt", "Ampere"], correctOption: 3 },
      { prompt: "Which gas makes up most of Earth's atmosphere?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Argon"], correctOption: 2 },
    ],
  },
  {
    key: "s2a-pilot-world-literature",
    title: "World Literature",
    description: "Authors, characters, and celebrated works.",
    startInMinutes: 1680,
    durationMinutes: 35,
    expectedParticipants: 50,
    maxParticipants: 80,
    questions: [
      { prompt: "Who wrote Things Fall Apart?", options: ["Chinua Achebe", "Wole Soyinka", "Ngũgĩ wa Thiong'o", "Ben Okri"], correctOption: 0 },
      { prompt: "In which Shakespeare play do Rosencrantz and Guildenstern appear?", options: ["Macbeth", "Hamlet", "King Lear", "Othello"], correctOption: 1 },
      { prompt: "Who wrote the novel Frankenstein?", options: ["Jane Austen", "Emily Brontë", "Mary Shelley", "Virginia Woolf"], correctOption: 2 },
      { prompt: "Which epic poem follows Odysseus on his journey home?", options: ["The Aeneid", "The Iliad", "Beowulf", "The Odyssey"], correctOption: 3 },
    ],
  },
  {
    key: "s2a-pilot-mathematics",
    title: "Mathematics Sprint",
    description: "Fast arithmetic, geometry, and number reasoning.",
    startInMinutes: 2040,
    durationMinutes: 25,
    expectedParticipants: 40,
    maxParticipants: 80,
    questions: [
      { prompt: "What is 15% of 200?", options: ["20", "25", "30", "35"], correctOption: 2 },
      { prompt: "What is the area of a rectangle 8 cm by 5 cm?", options: ["13 cm²", "26 cm²", "40 cm²", "80 cm²"], correctOption: 2 },
      { prompt: "Which of these numbers is prime?", options: ["21", "27", "33", "37"], correctOption: 3 },
      { prompt: "What is the mean of 4, 6, and 11?", options: ["6", "7", "8", "21"], correctOption: 1 },
    ],
  },
  {
    key: "s2a-pilot-technology",
    title: "Technology and Computing",
    description: "Computing concepts, the internet, and digital technology.",
    startInMinutes: 2880,
    durationMinutes: 90,
    expectedParticipants: 120,
    maxParticipants: 160,
    questions: [
      { prompt: "What does CPU stand for?", options: ["Central Processing Unit", "Computer Power Utility", "Core Program Upload", "Central Protocol User"], correctOption: 0 },
      { prompt: "Which language is primarily used to style web pages?", options: ["HTML", "CSS", "SQL", "Bash"], correctOption: 1 },
      { prompt: "What does HTTPS add to HTTP?", options: ["Compression", "Offline storage", "Encrypted transport", "Faster images"], correctOption: 2 },
      { prompt: "Which number system uses only 0 and 1?", options: ["Decimal", "Octal", "Hexadecimal", "Binary"], correctOption: 3 },
    ],
  },
  {
    key: "s2a-pilot-world-history",
    title: "World History",
    description: "Civilisations, historical turning points, and modern history.",
    startInMinutes: 3360,
    durationMinutes: 50,
    expectedParticipants: 80,
    maxParticipants: 120,
    questions: [
      { prompt: "In which year did the Berlin Wall fall?", options: ["1987", "1989", "1991", "1993"], correctOption: 1 },
      { prompt: "Which ancient civilisation built Machu Picchu?", options: ["Maya", "Aztec", "Inca", "Olmec"], correctOption: 2 },
      { prompt: "The Magna Carta was sealed in which year?", options: ["1066", "1215", "1492", "1649"], correctOption: 1 },
      { prompt: "Which city was the capital of the Byzantine Empire?", options: ["Athens", "Rome", "Alexandria", "Constantinople"], correctOption: 3 },
    ],
  },
  {
    key: "s2a-pilot-environment",
    title: "Environment and Climate",
    description: "Ecosystems, climate, and environmental stewardship.",
    startInMinutes: 4320,
    durationMinutes: 40,
    expectedParticipants: 90,
    maxParticipants: 120,
    questions: [
      { prompt: "Which atmospheric gas is most associated with human-caused warming?", options: ["Helium", "Carbon dioxide", "Neon", "Hydrogen"], correctOption: 1 },
      { prompt: "What is the term for the variety of life in an ecosystem?", options: ["Biomass", "Biodiversity", "Biodegradation", "Biotechnology"], correctOption: 1 },
      { prompt: "Which renewable source uses moving air to generate electricity?", options: ["Geothermal", "Tidal", "Wind", "Biomass"], correctOption: 2 },
      { prompt: "The ozone layer is mainly found in which atmospheric layer?", options: ["Troposphere", "Mesosphere", "Thermosphere", "Stratosphere"], correctOption: 3 },
    ],
  },
  {
    key: "s2a-pilot-economics",
    title: "Everyday Economics",
    description: "Core ideas about markets, money, and economic choices.",
    startInMinutes: 4680,
    durationMinutes: 75,
    expectedParticipants: 100,
    maxParticipants: 160,
    questions: [
      { prompt: "What does inflation describe?", options: ["A sustained rise in the general price level", "A fall in population", "A rise in exports only", "A reduction in interest rates"], correctOption: 0 },
      { prompt: "What is the opportunity cost of a choice?", options: ["Its listed price", "The value of the next-best alternative given up", "Its production time", "The total tax paid"], correctOption: 1 },
      { prompt: "If demand rises while supply stays the same, what usually happens to market price?", options: ["It falls", "It stays fixed", "It rises", "It becomes zero"], correctOption: 2 },
      { prompt: "Which institution typically sets a country's monetary policy?", options: ["The central bank", "The stock exchange", "The census bureau", "The postal service"], correctOption: 0 },
    ],
  },
  {
    key: "s2a-pilot-space",
    title: "Space and Astronomy",
    description: "The solar system, stars, and space exploration.",
    startInMinutes: 5760,
    durationMinutes: 55,
    expectedParticipants: 120,
    maxParticipants: 160,
    questions: [
      { prompt: "Which planet has the most prominent ring system?", options: ["Mars", "Saturn", "Earth", "Neptune"], correctOption: 1 },
      { prompt: "What is the name of our galaxy?", options: ["Andromeda", "Whirlpool", "Milky Way", "Sombrero"], correctOption: 2 },
      { prompt: "What force keeps planets in orbit around the Sun?", options: ["Magnetism", "Friction", "Electricity", "Gravity"], correctOption: 3 },
      { prompt: "Which was the first human-made object to reach space?", options: ["Sputnik 1", "Vostok 1", "Apollo 11", "Explorer 1"], correctOption: 0 },
    ],
  },
  {
    key: "s2a-pilot-logic",
    title: "Logic and Critical Thinking",
    description: "Patterns, careful deductions, and clear reasoning.",
    startInMinutes: 6240,
    durationMinutes: 20,
    expectedParticipants: 60,
    maxParticipants: 80,
    questions: [
      { prompt: "What comes next in the sequence 2, 4, 8, 16, …?", options: ["18", "24", "30", "32"], correctOption: 3 },
      { prompt: "All bloops are razzies. All razzies are lazzies. Which must be true?", options: ["All bloops are lazzies", "All lazzies are bloops", "No bloops are lazzies", "Some razzies are not bloops"], correctOption: 0 },
      { prompt: "A clock shows 3:00. What is the angle between its hands?", options: ["45°", "90°", "120°", "180°"], correctOption: 1 },
      { prompt: "If today is Tuesday, what day will it be 10 days from today?", options: ["Thursday", "Friday", "Saturday", "Sunday"], correctOption: 1 },
    ],
  },
  {
    key: "s2a-pilot-knowledge-finale",
    title: "S2A Mixed Knowledge Finale",
    description: "A broad final challenge across science, geography, culture, and mathematics.",
    startInMinutes: 7200,
    durationMinutes: 120,
    expectedParticipants: 160,
    maxParticipants: 320,
    questions: [
      { prompt: "Which continent contains the most countries?", options: ["Asia", "Africa", "Europe", "South America"], correctOption: 1 },
      { prompt: "What is the main gas in the Sun?", options: ["Oxygen", "Nitrogen", "Hydrogen", "Carbon dioxide"], correctOption: 2 },
      { prompt: "Which instrument measures atmospheric pressure?", options: ["Thermometer", "Anemometer", "Hygrometer", "Barometer"], correctOption: 3 },
      { prompt: "What is the square root of 144?", options: ["12", "14", "16", "18"], correctOption: 0 },
    ],
  },
];

async function seedPilot() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: admins } = await client.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1",
    );
    if (!admins.length) throw new Error("Create an administrator before seeding pilot competitions.");
    const adminUserId = admins[0].id;
    let createdQuizzes = 0;
    let createdCompetitions = 0;

    for (const quizData of pilotQuizzes) {
      let { rows } = await client.query(
        "SELECT id FROM quizzes WHERE seed_key = $1",
        [quizData.key],
      );
      let quizId;
      if (!rows.length) {
        ({ rows } = await client.query(
          `INSERT INTO quizzes (seed_key, title, description)
           VALUES ($1, $2, $3) RETURNING id`,
          [quizData.key, quizData.title, quizData.description],
        ));
        quizId = rows[0].id;
        createdQuizzes += 1;
        for (const [position, question] of quizData.questions.entries()) {
          await client.query(
            `INSERT INTO questions
               (quiz_id, position, prompt, options, correct_option, points, time_limit_seconds)
             VALUES ($1, $2, $3, $4, $5, 1000, 25)`,
            [quizId, position, question.prompt, JSON.stringify(question.options), question.correctOption],
          );
        }
        await recordAuditEvent(client, {
          actorUserId: adminUserId,
          action: "question_set_created",
          entityType: "quiz",
          entityId: quizId,
          metadata: { title: quizData.title, questionCount: quizData.questions.length, seeded: true },
        });
      } else {
        quizId = rows[0].id;
      }

      const { rows: existingMatches } = await client.query(
        "SELECT id FROM matches WHERE seed_key = $1",
        [quizData.key],
      );
      if (existingMatches.length) continue;

      const startsAt = new Date(Date.now() + quizData.startInMinutes * 60_000);
      const { rows: matches } = await client.query(
        `INSERT INTO matches
           (seed_key, quiz_id, host_user_id, starts_at, duration_minutes,
            max_participants, expected_participants, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
         RETURNING id`,
        [
          quizData.key,
          quizId,
          adminUserId,
          startsAt,
          quizData.durationMinutes,
          quizData.maxParticipants,
          quizData.expectedParticipants,
        ],
      );
      createdCompetitions += 1;
      await recordAuditEvent(client, {
        actorUserId: adminUserId,
        action: "competition_scheduled",
        entityType: "competition",
        entityId: matches[0].id,
        metadata: {
          quizId,
          startsAt,
          durationMinutes: quizData.durationMinutes,
          maxParticipants: quizData.maxParticipants,
          expectedParticipants: quizData.expectedParticipants,
          seeded: true,
        },
      });
    }

    await client.query("COMMIT");
    console.log(`Pilot seed complete: ${createdQuizzes} quizzes and ${createdCompetitions} competitions added.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seedPilot()
  .catch((error) => {
    console.error("Could not seed pilot competitions", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
