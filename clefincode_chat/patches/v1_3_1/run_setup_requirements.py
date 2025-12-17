import subprocess

def run_setup_requirements():
    try:
        subprocess.run(["bench", "setup", "requirements"], check=True)
        print("Requirements setup completed successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error running bench setup requirements: {e}")
        raise