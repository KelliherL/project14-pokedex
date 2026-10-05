// See https://aka.ms/new-console-template for more information
using MongoDB.Bson;
using ProcessPokeData;
using System.Net;
using System.Text;

Console.WriteLine("Starting to read file. (Excpected file name pokemon_utf8.csv)");
List<Pokemon> pokemonList = new List<Pokemon>();
Encoding encoding = Encoding.UTF8;
try
{
	StreamReader sr = new("pokemon_utf8.csv", encoding);
    sr.ReadLine();
    while (!sr.EndOfStream)
    {
        string line = sr.ReadLine();
        if (line != null)
        {
            Pokemon pokemon = new Pokemon();
            string[] data = line.Split(",");
            pokemon.nationalDex = Convert.ToInt32(data[0]);
            pokemon.generation = data[1];
            pokemon.enName = data[2];
            pokemon.jpName = data[3];
            pokemon.typings[0] = data[4];
            pokemon.typings[1] = data[5];
            pokemon.classification = data[6];
            if (float.TryParse(data[7], out float percentMale))
            {
                pokemon.percentMale = percentMale;
                pokemon.percentFemale = float.Parse(data[8]);
            }
            pokemon.heightM = float.Parse(data[9]);
            pokemon.weightKG = float.Parse(data[10]);
            pokemon.hp = int.Parse(data[11]);
            pokemon.attack = int.Parse(data[12]);
            pokemon.defense = int.Parse(data[13]);
            pokemon.spAttack = int.Parse(data[14]);
            pokemon.spDefense = int.Parse(data[15]);
            pokemon.speed = int.Parse(data[16]);
            string description = "";
            if(data.Length >= 18)
            {
                for (int i = 17; i < data.Length; i++)
                {
                    if(i == data.Length - 1)
                    {
                        description += data[i].ToString();
                    }
                    else
                    {
                        description += data[i].ToString() + ",";
                    }
                }
            }
            pokemon.description = description;
            pokemonList.Add(pokemon);
        }
    }
}
catch (Exception)
{
    Console.WriteLine("Something went wrong.");
    throw;
}
Console.WriteLine("Processed pokemon:" + pokemonList.Count);
var con = MongoDBMethods.GetMongoDatabase();
if(con == null)
{
    Console.WriteLine("connection failed?!");
    return;
}
var collection = con.GetCollection<Pokemon>("TestingDatabase");
int count = 0;
foreach (Pokemon pokemon in pokemonList)
{
    collection.InsertOne(pokemon);
    Console.WriteLine("Pokemon inserted: " + count++);
}
Console.WriteLine("Pokemon inserted?");
