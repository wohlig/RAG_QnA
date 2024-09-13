import functions_framework
from google.cloud import storage, bigquery
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig, Part
import vertexai.generative_models as generative_models
import json

# Triggered by a change in a storage bucket
@functions_framework.cloud_event
def hello_gcs(cloud_event):
   print("Function Triggered")
   data = cloud_event.data
   bucket = data["bucket"]
   name = data["name"]
  
   PROJECT_ID = "subjective-answer-eval-406712"
   LOCATION = "asia-south1"
   BQ_DATASET = "pw_transcript_dataset"  # Specify your BigQuery dataset
   BQ_TABLE = "pw_transcript_scores"  # Specify your BigQuery table
   vertexai.init(project="subjective-answer-eval-406712", location="asia-south1")
   print("Vertex AI Initiated")
  
   # Step 1: Transcribe the audio
   transcript = Transcribe(name, bucket)
   print("transcript done")


   cleanTranscript = cleanTranscription(transcript)
   print("Transcript Cleaned")
  
   # Step 2: Determine which sections should be NA using the NA function
   NA_Response = NA(cleanTranscript)
   print("NA_Response done")


   sections_marked_na = determine_na_sections(NA_Response)
   print("sections_marked_na done")


   # Step 3: Analyze transcript for each parameter, skip if NA
   rude_response = RudeBehaviour(cleanTranscript)
   print("rude_response done")


   # Introduction Section
   # intro_score, intro_total, intro_subpoints = (0, 'NA', {}) if sections_marked_na['Introduction'] else INTRODUCTION(transcript)
   if sections_marked_na['Introduction']:
       intro_score, max_intro_points, intro_metrics = (0, 0, {})
       print("Intro NA")
   else:
       intro_metrics = INTRODUCTION(cleanTranscript)
       max_intro_points = 10  # Set the maximum possible points for Introduction section
       intro_score = calculate_total_score(intro_metrics)
       print("intro_score done", intro_metrics, intro_score)
  
   # Rapport Section
   # rapport_score, rapport_total, rapport_subpoints = (0, 'NA', {}) if sections_marked_na['Rapport'] else RAPPOT(transcript)
   # print("rapport_score done", rapport_score, rapport_total, rapport_subpoints)
   if sections_marked_na['Rapport']:
       rapport_score, max_rapport, rapport_metrics = (0, 0, {})
       print("Rapport NA")
   else:
       rapport_metrics = RAPPOT(cleanTranscript)
       max_rapport  = 15
       rapport_score = calculate_total_score(rapport_metrics)
       print("rapport_score done", rapport_metrics, rapport_score)
  
   # Need Generation Section
   # needgen_score, needgen_total, needgen_subpoints = (0, 'NA', {}) if sections_marked_na['Need Generation'] else NEEDGEN(transcript)
   # print("needgen_score done", needgen_score, needgen_total, needgen_subpoints)
   if sections_marked_na['Need Generation']:
       needgen_score, max_needgen, needgen_metrics  = (0, 0, {})
       print("Need Generation NA")
   else:
       needgen_metrics = NEEDGEN(cleanTranscript)
       max_needgen = 15
       needgen_score = calculate_total_score(needgen_metrics)
       print("needgen_score done", needgen_metrics, needgen_score)
  
   # Product Pitch Section
   # product_score, product_total, product_subpoints = (0, 'NA', {}) if sections_marked_na['Product Pitch'] else PRODUCTPITCH(transcript)
   # print("product_score done", product_score, product_total, product_subpoints)
   if sections_marked_na['Product Pitch']:
       product_score, max_product, product_metrics = (0, 0, {})
       print("Product Pitch NA")
   else:
       product_metrics = PRODUCTPITCH(cleanTranscript)
       max_product = 25
       product_score = calculate_total_score(product_metrics)
       print("product_score done", product_metrics, product_score)
  
   # Closure Section
   # closure_score, closure_total, closure_subpoints = (0, 'NA', {}) if sections_marked_na['Closure'] else CLOSURE(transcript)
   # print("closure_score done", closure_score, closure_total, closure_subpoints)
   if sections_marked_na['Closure']:
       closure_score, max_closure, closure_metrics = (0, 0, {})
       print("Closure NA")
   else:
       closure_metrics = CLOSURE(cleanTranscript)
       print("My Closure", closure_metrics)
       max_closure = 15
       closure_score = calculate_total_score(closure_metrics)
  
   # Step 4: Calculate total scores
   total_score, total_possible_points = calculate_overall_score(
       intro_score, max_intro_points,
       rapport_score, max_rapport,
       needgen_score, max_needgen,
       product_score, max_product,
       closure_score, max_closure
   )
   print("total_score done", total_score, total_possible_points)
  
   # Step 5: Write to GCS
   outputbucketname = "pw_gcs_counsellorpwoutput"
   output_filename = name.split('.')[0] + "_transcript.txt"
   write_to_gcs(outputbucketname, output_filename, transcript)
   print("write_to_gcs done")


   output_score_filename = name.split('.')[0] + "_score.txt"
   feedback_content = {
       "NA": NA_Response,
       "Rude": rude_response,
       "Introduction": intro_metrics,
       "Rapport": rapport_metrics,
       "Need Generation": needgen_metrics,
       "Product": product_metrics,
       "Closure": closure_metrics,
       "Total Score": total_score,
       "Total Possible Points": total_possible_points
   }
   write_to_gcs(outputbucketname, output_score_filename, json.dumps(feedback_content, indent=4))
   print("write_to_gcs done")
  
   # Step 6: Store in BigQuery
   na_scenarios_json = json.dumps(NA_Response, indent=4)  # NA scenarios response


   # Call the BigQuery store function
   store_in_bigquery(
       cleanTranscript, intro_score, rapport_score, needgen_score,
       product_score, closure_score, total_score, total_possible_points,
       intro_metrics, rapport_metrics, needgen_metrics, product_metrics, closure_metrics,
       sections_marked_na, rude_response, BQ_DATASET, BQ_TABLE, na_scenarios_json, name
   )
   print(f"Processed file: {name} successfully")




# BigQuery storage function
def store_in_bigquery(
       transcript, intro_score, rapport_score, needgen_score, product_score, closure_score, total_score, total_possible_points,
       intro_metrics, rapport_metrics, needgen_metrics, product_metrics, closure_metrics,
       sections_marked_na, rude_response, BQ_DATASET, BQ_TABLE, na_scenarios_json, name):
  
   PROJECT_ID = "subjective-answer-eval-406712"  # Add your project ID here
   client = bigquery.Client(project=PROJECT_ID)


   row = {
       "transcription": transcript,
       "fileName": name,
       # NA status fields (now dynamic as JSON field)
       "na_scenarios": na_scenarios_json,  # Store the NA scenarios as a JSON field
       # Rude behavior fields
       "rude_status": rude_response["rude_behavior"]["status"],
       "rude_description": rude_response["rude_behavior"]["description"],
       # Introduction section
       "introduction_na": sections_marked_na.get('Introduction', False),
       "introduction_counselor_introduced": get_metric_score(intro_metrics, "Did the counselor introduce themselves as an Education Counselor calling from PW?"),
       # "introduction_acknowledged_interest": get_metric_score(intro_metrics, "Did the counselor appreciate the student for taking an interest in studying from PW?"),
       "introduction_app_download_confirmed": get_metric_score(intro_metrics, "Did the counselor check who downloaded the app?"),
       "introduction_called_for_guidance": get_metric_score(intro_metrics, "Did the counselor mention that the COUNSELOR is calling to guide/clear doubt regarding batches for NEET/JEE Preparation?"),
       "introduction_pw_brand_explained": get_metric_score(intro_metrics, "Did the counselor check if the student is aware of the brand PW/Physics Wallah and explained based on the learner's response?"),
       "introduction_total_score": intro_score,
       # Rapport section
       "rapport_na": sections_marked_na.get('Rapport', False),
       # "rapport_study_routine_discussed": get_metric_score(rapport_metrics, "Did the counselor ask about the student's study routine (e.g., how many hours the student studies daily)?"),
       "rapport_academic_performance_discussed": get_metric_score(rapport_metrics, "Did the counselor inquire about the student's academic performance (school, board, marks, language medium.)?"),
       "rapport_exam_preparation_strategy": get_metric_score(rapport_metrics, "Did the counselor explain the JEE/NEET exam preparation strategy to crack them?"),
       "rapport_challenges_asked": get_metric_score(rapport_metrics, "Did the counselor ask about any major challenges the student faces in exam preparation?"),
       "rapport_tuition_attendance_discussed": get_metric_score(rapport_metrics, "Did the counselor ask if the student attends any tuition/coaching?"),
       "rapport_total_score": rapport_score,
       # Need Generation section
       "need_generation_na": sections_marked_na.get('Need Generation', False),
       "need_generation_course_explained": get_metric_score(needgen_metrics, "Did the counselor effectively generate a need by explaining the benefits of the course features to the student?"),
       "need_generation_theoretical_knowledge": get_metric_score(needgen_metrics, "Did the counselor emphasize that students often do not spend enough time applying theoretical knowledge to real-world problem-solving?"),
       "need_generation_study_strategy": get_metric_score(needgen_metrics, "Did the counselor stress the importance of a specific preparation strategy for JEE/NEET exams?"),
       "need_generation_unverified_sources": get_metric_score(needgen_metrics, "Did the counselor explain that studying from unfamiliar or unverified sources can lead to difficulties in understanding concepts and effectively resolving doubts?"),
       "need_generation_relevant_examples": get_metric_score(needgen_metrics, "Did the counselor use relevant examples specific to the student's class or academic level to generate a need?"),
       "need_generation_total_score": needgen_score,
       # Product Pitch section
       "product_pitch_na": sections_marked_na.get('Product Pitch', False),
       "product_pitch_batch_details_explained": get_metric_score(product_metrics, "Did the counselor explain the batch details as per the student's inquiry?"),
       "product_pitch_batch_addons_explained": get_metric_score(product_metrics, "Did the counselor mention any batch add-ons (e.g., Infinity Batch features, mentorship, recorded videos)?"),
       "product_pitch_student_queries_handled": get_metric_score(product_metrics, "Did the counselor handle the student's queries effectively and correctly convey all information?"),
       # "product_pitch_support_options_explained": get_metric_score(product_metrics, "Did the counselor explain the support options available with PW/Physics Wallah?"),
       "product_pitch_fees_structure_explained": get_metric_score(product_metrics, "Did the counselor explain the fees structure and payment options for enrollment?"),
       "product_pitch_total_score": product_score,
       # Closure section
       "closure_na": sections_marked_na.get('Closure', False),
       "closure_urgency_for_enrollment": get_metric_score(closure_metrics, "Was the counselor able to create urgency for enrollment?"),
       "closure_objections_handled": get_metric_score(closure_metrics, "Did the counselor provide adequate assistance for objections/queries raised by the student?"),
       "closure_successful_call_closure": get_metric_score(closure_metrics, "Was the counselor able to close the call with instant enrollment/enrollment confirmation after few days, a follow-up planned or ended on a good note?"),
       "closure_total_score": closure_score,
       # Total score
       "total_score": total_score,
       "total_possible_points": total_possible_points
   }
  
   table_ref = client.dataset(BQ_DATASET).table(BQ_TABLE)
   table = client.get_table(table_ref)
  
   errors = client.insert_rows_json(table, [row])
   if errors:
       print(f"BigQuery Insert Errors: {errors}")
   else:
       print("Data successfully inserted into BigQuery")


   return "Data successfully inserted into BigQuery"


# Function to transcribe
def Transcribe(gcs_file_name, bucket_name):
   gs_uri = "gs://" + bucket_name + "/" + gcs_file_name
   audio_file = Part.from_uri(gs_uri, mime_type="audio/mpeg")
   print("audio file", audio_file)
   MODEL_ID = "gemini-1.5-pro-001"
   transcription_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are a helpful transcription expert."],
   )
  
   transcription_prompt = """


    TASK:
    Transcribe the telephonic conversation strictly as is in Romanised Hindi (Latin Hindi text only) between a Student or their Parent and Counsellor from PhysicsWallah/PW in the format given below:


    COUNSELLOR:
    STUDENT/PARENT:


    COUNSELLOR:
    STUDENT/PARENT:


    ...and so on.


    INSTRUCTIONS:


    1. IGNORE NOISE: Ignore any background noise, static, or irrelevant audio not related to the conversation between the Counsellor and the Student/Parent and don't show it in the final transcript.


    2. STRICT LATIN HINDI ONLY: Transcribe the conversation strictly in Latin Hindi (Romanised Hindi text). Do not use Devanagari script or any other language.


    3. ACCURACY IN SPEAKER IDENTIFICATION: Ensure that the speaker identification is accurate. You must not confuse which speaker (COUNSELLOR or STUDENT/PARENT) is saying what. Each speaker's lines should be correctly attributed.


    4. LABEL SPEAKERS: Clearly label each speaker (COUNSELLOR and STUDENT/PARENT) in the transcription as they speak. Do not mix or confuse the speakers’ lines. Every dialogue must be labelled as COUNSELLOR or STUDENT/PARENT. Don't give all dialogues of COUNSELLOR or that of STUDENT/PARENT together.


    5. EVERY DIALOGUE ON SINGLE LINE: Provide each dialogue on a single line. Don't club 2 dialogues together.


    5. NO ADDITIONAL NOTES: Do not add any additional elements, notes, comments, or interpretations. The transcription should reflect only the spoken conversation as heard.


    """
  
   generation_config = GenerationConfig(
       max_output_tokens=8192
   )
  
   # Correct call with 2 arguments: contents and generation_config
   response = transcription_model.generate_content(
       contents=[audio_file, transcription_prompt],
       generation_config=generation_config
   )
  
   return response.text


# Function to clean transcription
def cleanTranscription(transcription):
   MODEL_ID = "gemini-1.5-pro-001"
   transcription_model = GenerativeModel(
   MODEL_ID,
   system_instruction=[
       "You are an expert transcription analyst. Your task is to review a given transcription of a conversation between a Counsellor and a Student/Parent to ensure each dialogue line is correctly attributed and follows a logical flow based on the roles of the speakers. You must carefully analyze each line, determine if the attributed speaker makes sense in the context of the conversation, and make necessary corrections to ensure clarity and coherence."
   ],)


   transcription_prompt = f"""
    TRANSCRIPTION: {transcription}
    TASK: Analyze the transcription of a conversation between a Counsellor and a Student/Parent, correcting any misattributions and ensuring logical flow. If the given transcript contains any numbers that are written in text format, then convert them in number format, for example, 'gyaarvi' becomes '11', 'barvi' becomes '12'. If you don't understand something, then let it be as it is. For example, if you come across a strange name, then let it be as it is. Also make sure the text of the transcript is in Romanised Hindi (Latin Hindi) ONLY.


    INSTRUCTIONS:


    1. UNDERSTAND ROLES:


    COUNSELLOR: Uses formal language, provides guidance, answers questions, offers solutions, expresses gratitude, or ends the conversation formally.
    STUDENT/PARENT: Asks questions, provides information, expresses concerns, seeks clarification, or responds to the Counsellor.


    2. ANALYZE DIALOGUE:
    Review each dialogue and determine if it aligns with the speaker's role.


    3. CHECK FLOW:
    Ensure the conversation flows logically, with coherent responses between the Counsellor and the Student/Parent.


    4. CORRECT MISATTRIBUTIONS:
    Reassign any lines to the correct speaker if misattributed. For example, closing statements should come from the Counsellor.


    5. PROVIDE REVISED TRANSCRIPTION ONLY:
    Submit the corrected transcription without extra notes or formatting.


    """
  
   generation_config = GenerationConfig(
   max_output_tokens=8192)


   response = transcription_model.generate_content(
   contents=transcription_prompt,
   generation_config=generation_config,
   )   
   return response.text


# Function for Introduction
def INTRODUCTION(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with analyzing a transcript conversation between PhysicsWallah counselors and potential students/parents."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   # INSTRUCTIONS and METRICS
   instructions = """
   Please analyze the transcript and evaluate the counselor based on the following metrics.
   If a metric has multiple points, and the counselor meets or exceeds at least one of those points, then assign full marks for that metric.
   Be sure to either score 0 or score full marks. Full marks is the score that is given to you
   Your response should be in JSON format with fields for each metric, including:
   - metric: the name of the metric
   - score: the score assigned (0 or full score)
   - description: the reasoning behind the score, including citations from the transcript
   """
  
   metrics = [
       {"metric": "Did the counselor introduce themselves as an Education Counselor calling from PW?", "score": 2},
       # {"metric": "Did the counselor appreciate the student for taking an interest in studying from PW?", "score": 1},
       {"metric": "Did the counselor check who downloaded the app?", "score": 1.5},
       {"metric": "Did the counselor mention that the COUNSELOR is calling to guide/clear doubt regarding batches for NEET/JEE Preparation?", "score": 5},
       {"metric": "Did the counselor check if the student is aware of the brand PW/Physics Wallah and explained based on the learner's response?", "score": 1.5}
   ]
  
   # Prompt construction
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Please evaluate the counselor's performance based on the following metrics and output the results in the following JSON structure:
  
   {{
       "metrics": [
           {{
               "metric": "Metric description",
               "score": X,
               "description": "Citation from transcript justifying the score"
           }},
           ...
       ],
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}


   **METRICS**:
   {json.dumps(metrics, indent=4)}
   """
  
   contents = [prompt]
  
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]


  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       return json.loads(cleaned_response)


   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e




# Function for Rapport Section
def RAPPOT(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with analyzing a transcript conversation between PhysicsWallah counselors and potential students/parents."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   instructions = """
   Please analyze the transcript and evaluate the counselor based on the following metrics.
   If a metric has multiple points, and the counselor meets or exceeds at least one of those points, then assign full marks for that metric.
   Be sure to either score 0 or score full marks. Full marks is the score that is given to you
   Your response should be in JSON format with fields for each metric, including:
   - metric: the name of the metric
   - score: the score assigned (0 or full score)
   - description: the reasoning behind the score, including citations from the transcript
   """
  
   metrics = [
       # {"metric": "Did the counselor ask about the student's study routine (e.g., how many hours the student studies daily)?", "score": 3},
       {"metric": "Did the counselor inquire about the student's academic performance (school, board, marks, language medium)?", "score": 3.75},
       {"metric": "Did the counselor explain the JEE/NEET exam and the preparation strategy to crack them?", "score": 3.75},
       {"metric": "Did the counselor ask if the student attends any tuition/coaching?", "score": 3.75},
       {"metric": "Did the counselor ask about any major challenges the student faces in exam preparation?", "score": 3.75}
   ]
  
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Please evaluate the counselor's performance based on the following metrics and output the results in the following JSON structure:


   {{
       "metrics": [
           {{
               "metric": "Metric description",
               "score": X,
               "description": "Citation from transcript justifying the score"
           }},
           ...
       ],
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}


   **METRICS**:
   {json.dumps(metrics, indent=4)}
   """
  
   contents = [prompt]
  
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]
  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       return json.loads(cleaned_response)
   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e




# Function for Need Generation Section
def NEEDGEN(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with analyzing a transcript conversation between PhysicsWallah counselors and potential students/parents."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   instructions = """
   Please analyze the transcript and evaluate the counselor based on the following metrics.
   If a metric has multiple points, and the counselor meets or exceeds at least one of those points, then assign full marks for that metric.
   Be sure to either score 0 or score full marks. Full marks is the score that is given to you
   Your response should be in JSON format with fields for each metric, including:
   - metric: the name of the metric
   - score: the score assigned (0 or full score)
   - description: the reasoning behind the score, including citations from the transcript
   """
  
   metrics = [
       {"metric": "Did the counselor effectively generate a need by explaining the benefits of the course features to the student?", "score": 3},
       {"metric": "Did the counselor emphasize that students often do not spend enough time applying theoretical knowledge to real-world problem-solving?", "score": 3},
       {"metric": "Did the counselor stress the importance of a specific preparation strategy for JEE/NEET exams?", "score": 3},
       {"metric": "Did the counselor explain that studying from unfamiliar or unverified sources can lead to difficulties in understanding concepts and effectively resolving doubts?", "score": 3},
       {"metric": "Did the counselor use relevant examples specific to the student's class or academic level to generate a need?", "score": 3},
   ]
  
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Please evaluate the counselor's performance based on the following metrics and output the results in the following JSON structure:


   {{
       "metrics": [
           {{
               "metric": "Metric description",
               "score": X,
               "description": "Citation from transcript justifying the score"
           }},
           ...
       ],
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}


   **METRICS**:
   {json.dumps(metrics, indent=4)}
   """
  
   contents = [prompt]
  
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]
  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       return json.loads(cleaned_response)
   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e




# Function for Product Pitch Section
def PRODUCTPITCH(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with analyzing a transcript conversation between PhysicsWallah counselors and potential students/parents."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   instructions = """
   Please analyze the transcript and evaluate the counselor based on the following metrics.
   If a metric has multiple points, and the counselor meets or exceeds at least one of those points, then assign full marks for that metric.
   Be sure to either score 0 or score full marks. Full marks is the score that is given to you
   Your response should be in JSON format with fields for each metric, including:
   - metric: the name of the metric
   - score: the score assigned (0 or full score)
   - description: the reasoning behind the score, including citations from the transcript
   """
  
   metrics = [
       {"metric": "Did the counselor explain the batch details as per the student's inquiry?", "score": 6.25},
       {"metric": "Did the counselor mention any batch add-ons (e.g., Infinity Batch features, mentorship, recorded videos)?", "score": 6.25},
       {"metric": "Did the counselor handle the student's queries effectively and correctly convey all information?", "score": 6.25},
       # {"metric": "Did the counselor explain the support options available with PW/Physics Wallah?", "score": 5},
       {"metric": "Did the counselor explain the fees structure and payment options for enrollment?", "score": 6.25}
   ]
  
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Please evaluate the counselor's performance based on the following metrics and output the results in the following JSON structure:


   {{
       "metrics": [
           {{
               "metric": "Metric description",
               "score": X,
               "description": "Citation from transcript justifying the score"
           }},
           ...
       ],
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}


   **METRICS**:
   {json.dumps(metrics, indent=4)}
   """
  
   contents = [prompt]
  
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]
  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       return json.loads(cleaned_response)
       # calculate total score
       # total_score = 0
       # for metric in final_responese["metrics"]:
       #     total_score += metric["score"]
       # # add total_score in final_response
       # final_responese["total_score"] = total_score
       # final_responese["total_possible_points"] = 25
       # return final_responese
   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e




# Function for Closure Section
def CLOSURE(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with analyzing a transcript conversation between PhysicsWallah counselors and potential students/parents."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   instructions = """
   Please analyze the transcript and evaluate the counselor based on the following metrics.
   If a metric has multiple points, and the counselor meets or exceeds at least one of those points, then assign full marks for that metric.
   Be sure to either score 0 or score full marks. Full marks is the score that is given to you
   Your response should be in JSON format with fields for each metric, including:
   - metric: the name of the metric
   - score: the score assigned (0 or full score)
   - description: the reasoning behind the score, including citations from the transcript
   """
  
   metrics = [
       {"metric": "Was the counselor able to create urgency for enrollment?", "score": 5},
       {"metric": "Did the counselor provide adequate assistance for objections/queries raised by the student?", "score": 5},
       {"metric": "Was the counselor able to close the call with instant enrollment/enrollment confirmation after few days, a follow-up planned or ended on a good note?", "score": 5}
   ]
  
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Please evaluate the counselor's performance based on the following metrics and output the results in the following JSON structure:


   {{
       "metrics": [
           {{
               "metric": "Metric description",
               "score": X,
               "description": "Citation from transcript justifying the score"
           }},
           ...
       ]
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}


   **METRICS**:
   {json.dumps(metrics, indent=4)}
   """
  
   contents = [prompt]
  
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]
  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       closure_response_new = json.loads(cleaned_response)
       print("Closure, Response", json.dumps(closure_response_new, indent=2))
       return json.loads(cleaned_response)
   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e




# Function for NA Status (Not Applicable Sections)
def NA(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with analyzing a transcript and identifying which sections of the call should be marked as Not Applicable (NA)."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   instructions = """
   Please analyze the transcript and identify which sections of the call should be marked as Not Applicable (NA).
   Your response should be in JSON format with fields for each scenario, including:
   - scene: the description of the scenario
   - status: true/false indicating if the section is NA
   - description: the reasoning behind the decision, including citations from the transcript
   """
  
   na_scenarios = f"""
       1. Call ended due to a voice issue at the very start: The call started, but due to voice issues, it disconnected immediately, preventing any further conversation.


       2. Student only wants enrollment assistance after reviewing batch details: The student has already reviewed all the batch details independently and only wants assistance to complete the enrollment process, with no need for further discussion.


       3. Parent on the call requests a callback after hearing about PW: The call connected with the parent instead of the student. After briefly hearing about PW and the student's academic interest, the parent, not knowing the details, requested a callback without engaging further.


       4. Already enrolled student only needs specific help/guidance based on their needs: The student is already enrolled with PW and is fully aware of the platform and faculty. They only want specific guidance and solutions based on their individual needs.


       5. Learner only wants a discount or coupon for batch enrollment: The learner is solely focused on getting a coupon code or extra discount to enroll in a batch and is not interested in discussing other details.


       6. Learner is not interested in enrolling and has no further queries: The learner has decided not to enroll because they are satisfied with free content, are already enrolled elsewhere, or want a batch in a language not available, and they have no additional questions.


       7. Learner only wants clarification on course features or exam results for enrollment: The learner is ready to enroll but needs specific clarifications regarding course features or exam results. They are not looking for any other information or discussion.


       8. Learner or parent is solely interested in batch details: The learner or parent has no other questions and is only interested in knowing the specific details of available batches.


       9. Learner is not preparing for JEE or NEET, indicating no further interest: The learner is not planning to prepare for any specific exam, and therefore, they have no interest in further discussion about PW’s offerings.


       10. Call ended abruptly after discussing course benefits and preparation strategies(need generation): The call concentrated on explaining the benefits of the course, effective strategies for JEE/NEET preparation, and the drawbacks of using unverified sources. The call was disconnected abruptly afterward, leaving no room for the counselor to provide the batch details and fee structure of the course.


       11. Call ended abruptly after learner was pitched course, batch details and fee structure(product pitch): The call reached the Product(PW Batch and fee structure) Pitch stage but was disconnected abruptly afterward, leaving no room for the counselor to explain the enrollment process for the batch and give an option for 'contact us'.


       12. Call conducted effectively with a structured flow: The call began with the counsellor asking if the student is aware about physicswallah, followed by asking the student their academic performance, their major challenges for exam preparation, discussing course benefits and preparation strategies, and a course pitch along with batch details and fee structure. The counselor then explained the enrollment process for the batch and gave an option for 'contact us' and ended the call on a good note, and the learner responded positively, leading to a smooth conclusion.


   """
  
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Identify the scenario that the provided transcript falls under, based on the list of scenarios. Pick ONLY ONE appropriate scenario from all the given scenarios and output ONLY ONE object in the following JSON structure:


   {{
       "scene": "scenario title only. No description required",
       "status": true
       "description": "Citation from transcript justifying the decision"
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}


   **SCENARIOS**:
   {na_scenarios}
   """
  
   contents = [prompt]


   # Send request to model
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]
  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       return json.loads(cleaned_response)
   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e


# Function for Rude Behavior Evaluation
def RudeBehaviour(transcript):
   MODEL_ID = "gemini-1.5-pro-001"
   predictive_model = GenerativeModel(
       MODEL_ID,
       system_instruction=["You are an AI-based auditor tasked with detecting rude behavior in the transcript."]
   )
  
   generation_config = GenerationConfig(
       temperature=0,
       top_p=1.0,
       top_k=32,
       candidate_count=1,
       max_output_tokens=8192,
   )
  
   instructions = """
   Please analyze the transcript and detect any rude behavior.
   Your response should be in JSON format with fields for:
   - status: true/false indicating if rude behavior was detected
   - description: reasoning behind the decision, including citations from the transcript
   """
  
   prompt = f"""
   You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
   Please evaluate if there was any rude behavior and output the result in the following JSON structure:


   {{
       "rude_behavior": {{
           "status": true/false,
           "description": "Citation from transcript justifying the decision"
       }}
   }}


   **INSTRUCTIONS**:
   {instructions}


   **CONVERSATION**:
   {transcript}
   """
  
   contents = [prompt]
  
   response = predictive_model.generate_content(
       contents=contents,
       generation_config=generation_config
   )
   cleaned_response = response.text.strip("```json")
   cleaned_response = cleaned_response.strip("```")
   cleaned_response = cleaned_response.strip()


   # check if last character is a } or not, if it is not then remove last 3 characters
   if cleaned_response[-1] != "}":
       print(" Introduction Didnt get stripped")
       cleaned_response = cleaned_response[:-3]
  
   # Handle empty response or malformed response
   if not response or not response.text.strip():
       raise ValueError("Received empty response from the model", response.text)
  
   try:
       return json.loads(cleaned_response)
   except json.JSONDecodeError as e:
       # Log the actual response for debugging
       print(f"Failed to parse response as JSON. Response received: {cleaned_response}")
       raise e




# Function to calculate overall score
def calculate_overall_score(*scores):
   total_score = 0
   total_possible_points = 0
   for score, total in zip(scores[::2], scores[1::2]):
       if isinstance(score, str):
           score = 0 if score == 'NA' else int(score)
       if isinstance(total, str):
           total = 0 if total == 'NA' else int(total)
       total_score += score
       total_possible_points += total
   return total_score, total_possible_points




# Function to write to GCS
def write_to_gcs(gcs_bucket, gcs_file_name, content):
   storage_client = storage.Client()
   bucket = storage_client.bucket(gcs_bucket)
   blob = bucket.blob(gcs_file_name)
  
   with blob.open("w") as f:
       f.write(content)




# Example for determining NA sections based on the NA Response
def determine_na_sections(scene):
   sections = {
       'Introduction': False,
       'Rapport': False,
       'Need Generation': False,
       'Product Pitch': False,
       'Closure': False
   }
  
   if "Call disconnected due to a voice issue" in scene["scene"] and scene["status"]:
       print("call was disconnected")
       sections['Introduction'] = True
       sections["Rapport"] = True
       sections["Need Generation"] = True
       sections["Product Pitch"] = True
       sections["Closure"] = True
   elif "enrollment assistance" in scene["scene"] and scene["status"]:
       print("enrollment assistance")
       sections['Need Generation'] = True
       sections["Introduction"] = True
   elif "callback" in scene["scene"] and scene["status"]:
       print("callback")
       sections['Closure'] = True
       sections["Need Generation"] = True
       sections["Product Pitch"] = True
   elif "Already enrolled student" in scene["scene"] and scene["status"]:
       print("already enrolled")
       sections['Need Generation'] = True
       sections['Introduction'] = True
   elif "discount or coupon" in scene["scene"] and scene["status"]:
       print("discount or coupon")
       sections['Need Generation'] = True
       sections['Introduction'] = True
   elif "not interested in enrolling" in scene["scene"] and scene["status"]:
       print("free content")
       sections['Need Generation'] = True
       sections['Introduction'] = True
   elif "clarification on course features" in scene["scene"] and scene["status"]:
       print("inquiring about the course features")
       sections['Need Generation'] = True
       sections['Introduction'] = True
   elif "interested in batch details" in scene["scene"] and scene["status"]:
       print("interest in knowing the batch details")
       sections["Need Generation"] = True
   elif "not preparing for JEE or NEET" in scene["scene"] and scene["status"]:
       print("target exam")
       sections["Need Generation"] = True
       sections['Product Pitch'] = True
       sections["Closure"] = True
   elif "course benefits and preparation strategies" in scene["scene"] and scene["status"]:
       print("call ended abruptly after need generation")
       sections['Closure'] = True
       sections["Product Pitch"] = True
   elif "learner was pitched course, batch details and fee structure" in scene["scene"] and scene["status"]:
       print("call ended abruptly after product pitch")
       sections['Closure'] = True
   else:
       print("No NA Sections")
      
  
   return sections


def calculate_total_score(metrics_response: dict) -> int:
   total_score = 0
   for metric in metrics_response["metrics"]:
       total_score += metric["score"]
   return total_score


def get_metric_score(metrics, metric_name):
   if(metrics == {}):
       return 0
   for metric in metrics["metrics"]:
       if metric["metric"] == metric_name:
           print("Got metric score", metric["score"])
           return metric["score"]
   return 0