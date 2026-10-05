from fastapi import FastAPI, HTTPException, status
from pymongo import MongoClient
import json

def pokemonbyid(id: int):
    try:
        collection = database.get_collection("TestingDatabase")
        pokemon = collection.find_one({ "_id" : id })
        return json.dumps(pokemon)
    except:
        return 0

try:
    client = MongoClient("mongodb://localhost:27017/")
    database = client.get_database("PokeVision")
except Exception as e:
    print("An error occurred when connecting to the database")
    print(e)

app = FastAPI()

@app.get("/Pokemon/{pokemon_id}")
def read_root(pokemon_id: int):
    pokemon = pokemonbyid(pokemon_id)
    if pokemon_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The requested item could not be found."
        )
    elif pokemon_id == 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The server failed to execute the request."
        )
    else:
        return pokemon

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)