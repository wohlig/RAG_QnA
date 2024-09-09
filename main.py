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
    
    # Step 2: Determine which sections should be NA using the NA function
    NA_Response = NA(transcript)
    print("NA_Response done")

    sections_marked_na = determine_na_sections(NA_Response)
    print("sections_marked_na done")

    # Step 3: Analyze transcript for each parameter, skip if NA
    rude_response = RudeBehaviour(transcript)
    print("rude_response done")

    # Introduction Section
    intro_score, intro_total, intro_subpoints = (0, 'NA', {}) if sections_marked_na['Introduction'] else INTRODUCTION(transcript)
    print("intro_score done")
    
    # Rapport Section
    rapport_score, rapport_total, rapport_subpoints = (0, 'NA', {}) if sections_marked_na['Rapport'] else RAPPOT(transcript)
    print("rapport_score done")
    
    # Need Generation Section
    needgen_score, needgen_total, needgen_subpoints = (0, 'NA', {}) if sections_marked_na['Need Generation'] else NEEDGEN(transcript)
    print("needgen_score done")
    
    # Product Pitch Section
    product_score, product_total, product_subpoints = (0, 'NA', {}) if sections_marked_na['Product Pitch'] else PRODUCTPITCH(transcript)
    print("product_score done")
    
    # Closure Section
    closure_score, closure_total, closure_subpoints = (0, 'NA', {}) if sections_marked_na['Closure'] else CLOSURE(transcript)
    print("closure_score done")
    
    # Step 4: Calculate total scores
    total_score, total_possible_points = calculate_overall_score(
        intro_score, intro_total,
        rapport_score, rapport_total,
        needgen_score, needgen_total,
        product_score, product_total,
        closure_score, closure_total
    )
    print("total_score done")
    
    # Step 5: Write to GCS
    outputbucketname = "pw_gcs_counsellorpwoutput"
    output_filename = name.split('.')[0] + "_transcript.txt"
    write_to_gcs(outputbucketname, output_filename, transcript)
    print("write_to_gcs done")

    output_score_filename = name.split('.')[0] + "_score.txt"
    feedback_content = {
        "NA": NA_Response,
        "Rude": rude_response,
        "Introduction": intro_subpoints,
        "Rapport": rapport_subpoints,
        "Need Generation": needgen_subpoints,
        "Product": product_subpoints,
        "Closure": closure_subpoints,
        "Total Score": total_score,
        "Total Possible Points": total_possible_points
    }
    write_to_gcs(outputbucketname, output_score_filename, json.dumps(feedback_content, indent=4))
    print("write_to_gcs done")
    
    # Step 6: Store in BigQuery
    store_in_bigquery(
        transcript, intro_score, rapport_score, needgen_score, 
        product_score, closure_score, total_score, total_possible_points,
        intro_subpoints, rapport_subpoints, needgen_subpoints, product_subpoints, closure_subpoints,
        sections_marked_na, rude_response, BQ_DATASET, BQ_TABLE
    )

    print(f"Processed file: {name} successfully")


# BigQuery storage function
def store_in_bigquery(
        transcript, intro_score, rapport_score, needgen_score, product_score, closure_score, total_score, total_possible_points,
        intro_subpoints, rapport_subpoints, needgen_subpoints, product_subpoints, closure_subpoints,
        sections_marked_na, rude_response, BQ_DATASET, BQ_TABLE):
    
    PROJECT_ID = "subjective-answer-eval-406712"  # Add your project ID here
    client = bigquery.Client(project=PROJECT_ID)
    
    # Convert `sections_marked_na` (na_status) to JSON
    na_status_json = json.dumps(sections_marked_na)

    row = {
        "transcript": transcript,
        "introduction_score": intro_score,
        "rapport_score": rapport_score,
        "needgen_score": needgen_score,
        "product_score": product_score,
        "closure_score": closure_score,
        "total_score": total_score,
        "total_possible_points": total_possible_points,
        "intro_subpoints": intro_subpoints,
        "rapport_subpoints": rapport_subpoints,
        "needgen_subpoints": needgen_subpoints,
        "product_subpoints": product_subpoints,
        "closure_subpoints": closure_subpoints,
        "na_status": na_status_json,  # Convert to JSON string
        "rude_response": rude_response
    }
    
    table_ref = client.dataset(BQ_DATASET).table(BQ_TABLE)
    table = client.get_table(table_ref)
    
    errors = client.insert_rows_json(table, [row])
    if errors:
        print(f"BigQuery Insert Errors: {errors}")
    else:
        print("Data successfully inserted into BigQuery")

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
    
    transcription_prompt = f"""
    Transcribe the conversation in Romanized Hindi between the counselor and the student/parent.
    1. Ignore background noise.
    2. Transcription should be in LATIN text.

    Transcribed the Telephonic conversation STRICTLY As Is in ROMANISED HINDI and NOT IN Devanagari, between Student or their Parent and Counsellor from PhysicsWallah/PW.
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
    Your response should be in JSON format with fields for each metric, including:
    - metric: the name of the metric
    - score: the score assigned (0 or full score)
    - description: the reasoning behind the score, including citations from the transcript
    """
    
    metrics = [
        {"metric": "Did the counselor introduce themselves as an Education Counselor calling from PW?", "score": 2},
        {"metric": "Did the counselor appreciate the student for taking an interest in studying from PW?", "score": 1},
        {"metric": "Did the counselor check who downloaded the app?", "score": 1},
        {"metric": "Did the counselor mention that the COUNSELOR is calling to guide/clear doubt regarding batches for NEET/JEE Preparation?", "score": 5},
        {"metric": "Did the counselor check if the student is aware of the brand PW/Physics Wallah and explained based on the learner's response?", "score": 1}
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
        "total_score": X,
        "total_possible_score": X
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
    cleaned_response = response.text.strip("```json").strip("```").strip()
    
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
    Your response should be in JSON format with fields for each metric, including:
    - metric: the name of the metric
    - score: the score assigned (0 or full score)
    - description: the reasoning behind the score, including citations from the transcript
    """
    
    metrics = [
        {"metric": "Did the counselor ask about the student's study routine (e.g., how many hours the student studies daily)?", "score": 3},
        {"metric": "Did the counselor inquire about the student's academic performance (school, board, marks, etc.)?", "score": 3},
        {"metric": "Did the counselor explain the JEE/NEET exam preparation strategy?", "score": 3},
        {"metric": "Did the counselor ask about the student's attendance in tuition/coaching?", "score": 3},
        {"metric": "Did the counselor ask about any major challenges the student faces in exam preparation?", "score": 3}
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
        "total_score": X,
        "total_possible_score": X
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
    cleaned_response = response.text.strip("```json").strip("```").strip()
    
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
    Your response should be in JSON format with fields for each metric, including:
    - metric: the name of the metric
    - score: the score assigned (0 or full score)
    - description: the reasoning behind the score, including citations from the transcript
    """
    
    metrics = [
        {"metric": "Did the counselor explain the course/batch/faculty that addresses a specific student challenge?", "score": 3},
        {"metric": "Did the counselor mention clearing basic concepts for NEET/JEE preparation (e.g., conceptual learning, application-based learning)?", "score": 3},
        {"metric": "Did the counselor emphasize the JEE/NEET preparation strategy (e.g., study plan, syllabus management)?", "score": 3},
        {"metric": "Did the counselor talk about revision or doubt solving?", "score": 3},
        {"metric": "Did the counselor handle any preparation-related challenges raised by the student?", "score": 3}
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
        "total_score": X,
        "total_possible_score": X
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
    cleaned_response = response.text.strip("```json").strip("```").strip()
    
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
    Your response should be in JSON format with fields for each metric, including:
    - metric: the name of the metric
    - score: the score assigned (0 or full score)
    - description: the reasoning behind the score, including citations from the transcript
    """
    
    metrics = [
        {"metric": "Did the counselor explain the batch details as per the student's inquiry?", "score": 5},
        {"metric": "Did the counselor mention any batch add-ons (e.g., Infinity Batch features, mentorship, recorded videos)?", "score": 5},
        {"metric": "Did the counselor handle the student's queries effectively?", "score": 5},
        {"metric": "Did the counselor explain the support options available with PW/Physics Wallah?", "score": 5},
        {"metric": "Did the counselor explain the fees structure and payment options for enrollment?", "score": 5}
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
        "total_score": X,
        "total_possible_score": X
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
    cleaned_response = response.text.strip("```json").strip("```").strip()
    
    # Handle empty response or malformed response
    if not response or not response.text.strip():
        raise ValueError("Received empty response from the model", response.text)
    
    try:
        return json.loads(cleaned_response)
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
    Your response should be in JSON format with fields for each metric, including:
    - metric: the name of the metric
    - score: the score assigned (0 or full score)
    - description: the reasoning behind the score, including citations from the transcript
    """
    
    metrics = [
        {"metric": "Was the counselor able to create urgency for enrollment?", "score": 5},
        {"metric": "Did the counselor provide adequate assistance for objections/queries raised by the student?", "score": 5},
        {"metric": "Was the counselor able to close the call with enrollment done or a follow-up planned?", "score": 5}
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
        "total_score": X,
       
        "total_possible_score": X
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
    cleaned_response = response.text.strip("```json").strip("```").strip()
    
    # Handle empty response or malformed response
    if not response or not response.text.strip():
        raise ValueError("Received empty response from the model", response.text)
    
    try:
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
    
    na_scenarios = [
        "Call was disconnected before the introduction was completed.",
        "The primary focus of the call was enrollment assistance, with no detailed discussion of course batches.",
        "The counselor received a lead for a student preparing for an exam other than NEET/JEE.",
        "The student or parent requested a callback, leading to an incomplete or shortened conversation.",
        "The student is already enrolled in a course at PW for NEET/JEE preparation.",
        "The primary ask of the student was a discount or coupon code.",
        "The student was not preparing for NEET/JEE (No target exam mentioned).",
        "The call ended abruptly before closure."
    ]
    
    prompt = f"""
    You will be provided a call transcript conversation between a student/parent and a counselor from Physics Wallah.
    Please identify which sections of the call are Not Applicable (NA) based on the following scenarios and output the results in the following JSON structure:

    {{
        "na_scenarios": [
            {{
                "scene": "Scenario description",
                "status": true/false,
                "description": "Citation from transcript justifying the decision"
            }},
            ...
        ]
    }}

    **INSTRUCTIONS**:
    {instructions}

    **CONVERSATION**:
    {transcript}

    **SCENARIOS**:
    {json.dumps(na_scenarios, indent=4)}
    """
    
    contents = [prompt]

    # Send request to model
    response = predictive_model.generate_content(
        contents=contents,
        generation_config=generation_config
    )
    cleaned_response = response.text.strip("```json").strip("```").strip()
    
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
        if total != 'NA':
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
def determine_na_sections(na_response):
    sections = {
        'Introduction': False,
        'Rapport': False,
        'Need Generation': False,
        'Product Pitch': False,
        'Closure': False
    }
    
    for scene in na_response["na_scenarios"]:
        if "call disconnected" in scene["scene"] and scene["status"]:
            sections['Introduction'] = True
        elif "enrollment assistance" in scene["scene"] and scene["status"]:
            sections['Need Generation'] = True
        elif "exam other than NEET/JEE" in scene["scene"] and scene["status"]:
            sections['Product Pitch'] = True
        elif "callback" in scene["scene"] and scene["status"]:
            sections['Closure'] = True
        elif "already enrolled" in scene["scene"] and scene["status"]:
            sections['Product Pitch'] = True
        elif "discount or coupon" in scene["scene"] and scene["status"]:
            sections['Need Generation'] = True
        elif "no target exam" in scene["scene"] and scene["status"]:
            sections['Need Generation'] = True
        elif "call ended abruptly" in scene["scene"] and scene["status"]:
            sections['Closure'] = True
    
    return sections
