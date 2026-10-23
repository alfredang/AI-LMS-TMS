-- Disposable mms_handover_test PostgreSQL database ONLY.
CREATE TABLE course(id uuid PRIMARY KEY,course_code text);
CREATE TABLE course_run(id uuid PRIMARY KEY,course_id uuid REFERENCES course(id),course_run_id text);
CREATE TABLE masterlist_table(id uuid PRIMARY KEY,class_id uuid,name text);
CREATE TABLE enrollment(id uuid PRIMARY KEY,course_run_id uuid,name text);
CREATE TABLE course_session(id uuid PRIMARY KEY,course_run_id uuid,name text);
CREATE TABLE course_run_trainer(id uuid PRIMARY KEY,course_run_id uuid,name text);
CREATE TABLE da_application(id uuid PRIMARY KEY,course_run_id text,name text);
CREATE TABLE company_application(id uuid PRIMARY KEY,course_run_id text,name text);
CREATE TABLE app_user(id uuid PRIMARY KEY,full_name text);
CREATE TABLE trainer_profile(user_id uuid PRIMARY KEY,tel text);
CREATE TABLE learner_profile(user_id uuid PRIMARY KEY,tel text);
CREATE TABLE user_role_map(user_id uuid,role_id uuid);
