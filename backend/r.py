import pandas as pd
import joblib
import numpy as np
from microai_model import * #sure this module is available in your environment

def main():
    # 1. Configuration paths
    model_path = '/workspaces/microai_api/backend/models/GSE7390_model (1).joblib'
    tsv_path = '/workspaces/microai_api/backend/GES7390_demo_x (4).tsv'
    output_path = '/workspaces/microai_api/backend/GSE7390_predictions.csv'

    print("[-] Loading MICROAI model...")
    model = joblib.load(model_path)

    print("[-] Loading test dataset...")
    # Do NOT use index_col=0 so columns remain aligned as features
    df = pd.read_csv(tsv_path, sep='\t',index=False)
    print(f"    Loaded dataset with shape: {df.shape}")

    # 2. Extract raw features matrix (samples x genes)
    X_test = df.to_numpy(dtype=float)

    print("[-] Running preprocessing, feature selection, and inference...")
    predictions = model.predict(X_test)
    probabilities = model.predict_proba(X_test)

    # 3. Append results to the dataframe
    df['Predicted_Output'] = predictions
    df['Prob_Class_0'] = probabilities[:, 0]
    df['Prob_Class_1'] = probabilities[:, 1]

    # 4. Save results (index=False since columns are numeric features)
    df.to_csv(output_path, index=False)
    print(f"[+] Success! Predictions saved to: {output_path}")
    
    # Preview top results
    print("\nPreview of Results:")
    print(df[['Predicted_Output', 'Prob_Class_0', 'Prob_Class_1']].head())

if __name__ == "__main__":
    main()