using MongoDB.Bson;
using MongoDB.Driver;
using Oracle.ManagedDataAccess.Client;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ProcessPokeData
{
    /// <summary>
    /// This class contains code to connect to the mongodb
    /// </summary>
    internal class MongoDBMethods
    {
        private static IMongoDatabase database;

        public static IMongoDatabase GetMongoDatabase()
        {
            if (database != null)
                return database;

            string connectionString = "mongodb://127.0.0.1:27017";
            string databaseName = "PokeVision";

            MongoClient client = new MongoClient(connectionString);

            database = client.GetDatabase(databaseName);

            return database;
        }
    }
}
