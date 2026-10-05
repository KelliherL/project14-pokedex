using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Threading.Tasks;

namespace ProcessPokeData
{
    internal class Pokemon
    {
        [BsonId]
        [BsonRepresentation(BsonType.Int32)]
        public int nationalDex;

        public string generation;

        public string enName;

        public string jpName;

        public string[] typings = new string[2];
        
        public string classification;

        public float percentMale;

        public float percentFemale;

        public float heightM;

        public float weightKG;

        public int hp;

        public int attack;

        public int defense;

        public int spAttack;

        public int spDefense;

        public int speed;
        [BsonRepresentation(BsonType.String)]
        public string description;

    }
}
