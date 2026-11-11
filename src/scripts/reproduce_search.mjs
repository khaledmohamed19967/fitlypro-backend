import 'dotenv/config';
import connectDatabase from '../config/database.js';
import exerciseService from '../modules/exercises/exercise.service.js';

async function run(){
  await connectDatabase();
  const trainerId = '69e53cd0da78b14fa245be32'; // from DB
  const queries = [
    'bench press',
    'bench press smith',
    'smith machine bench press',
    'smith bench press',
    'Smith Machine Bench Press',
    'bench',
    'press smith'
  ];
  for(const q of queries){
    console.log('--- Query:', q);
    const result = await exerciseService.getExercises({search:q, page:1, limit:24}, trainerId);
    console.log('Total matches:', result.pagination.total);
    console.log('Returned count:', result.exercises.length);
    console.log('Names:', result.exercises.map(e=>e.name));
    const found = result.exercises.some(e=>e.name.toLowerCase()==='smith machine bench press');
    console.log('Contains target:', found);
  }
  process.exit(0);
}
run().catch(err=>{console.error(err);process.exit(1);});
