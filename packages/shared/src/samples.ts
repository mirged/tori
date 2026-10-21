import type { Quiz } from './protocol.js';
export const samples: Quiz[] = [
  {
    version: 1, id: 'little-bit-of-everything', title: 'A little bit of everything',
    description: 'Big ideas, small surprises. The perfect warm-up for a curious crowd.',
    category: 'General knowledge', cover: 'green',
    questions: [
      { id: 'octopus', type: 'single', text: 'How many hearts does an octopus have?', options: ['One', 'Two', 'Three', 'Eight'], correct: [2], seconds: 20, explanation: 'Two hearts pump blood to the gills. The third keeps it flowing to the rest of the body.' },
      { id: 'venus', type: 'boolean', text: 'A day on Venus is longer than a year on Venus.', options: ['True', 'False'], correct: [0], seconds: 20, explanation: 'Venus takes about 243 Earth days to rotate, but only 225 to orbit the Sun.' },
      { id: 'mammals', type: 'multiple', text: 'Which of these animals are mammals?', options: ['Dolphin', 'Penguin', 'Bat', 'Octopus'], correct: [0, 2], seconds: 25, explanation: 'Dolphins and bats are warm-blooded mammals that nurse their young.' },
      { id: 'blue', type: 'single', text: 'Which planet is known as the blue planet?', options: ['Mars', 'Earth', 'Saturn', 'Mercury'], correct: [1], seconds: 15, explanation: 'Oceans cover about 71% of Earth’s surface, giving it a blue appearance from space.' },
      { id: 'honey', type: 'single', text: 'What do bees collect from flowers to make honey?', options: ['Pollen', 'Petals', 'Nectar', 'Seeds'], correct: [2], seconds: 20, explanation: 'Bees turn sugary flower nectar into honey. Pollen is a separate food source.' },
    ],
  },
  {
    version: 1, id: 'wild-and-wonderful', title: 'Wild & wonderful',
    description: 'Meet the remarkable creatures we share our planet with.', category: 'Nature', cover: 'peach',
    questions: [
      { id: 'giraffe', type: 'single', text: 'How many bones are in a giraffe’s neck?', options: ['7', '14', '21', '28'], correct: [0], seconds: 20, explanation: 'Like most mammals, including humans, giraffes have seven neck vertebrae.' },
      { id: 'butterfly', type: 'boolean', text: 'Butterflies taste with their feet.', options: ['True', 'False'], correct: [0], seconds: 20, explanation: 'Taste receptors on their feet help butterflies find suitable plants for laying eggs.' },
      { id: 'birds', type: 'multiple', text: 'Which birds cannot fly?', options: ['Ostrich', 'Eagle', 'Penguin', 'Sparrow'], correct: [0, 2], seconds: 25, explanation: 'Ostriches are built for running; penguins use their wings as flippers.' },
    ],
  },
  {
    version: 1, id: 'out-of-this-world', title: 'Out of this world',
    description: 'Take your curiosity on a trip around the solar system.', category: 'Science & space', cover: 'lilac',
    questions: [
      { id: 'jupiter', type: 'single', text: 'Which is the largest planet in our solar system?', options: ['Earth', 'Neptune', 'Jupiter', 'Saturn'], correct: [2], seconds: 20, explanation: 'Jupiter is more than twice as massive as all the other planets combined.' },
      { id: 'sun', type: 'boolean', text: 'The Sun is a star.', options: ['True', 'False'], correct: [0], seconds: 15, explanation: 'Our Sun is a star at the center of the solar system, powered by nuclear fusion.' },
      { id: 'rock', type: 'multiple', text: 'Which are rocky planets?', options: ['Mercury', 'Jupiter', 'Mars', 'Neptune'], correct: [0, 2], seconds: 25, explanation: 'Mercury, Venus, Earth, and Mars are the four terrestrial planets.' },
    ],
  },
];
